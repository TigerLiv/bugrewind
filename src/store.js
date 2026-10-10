import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { id, fingerprint, short, safeDetail, assert } from './security.js';

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(path.join(dataDir, 'chunks'), { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'bugrewind.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), route TEXT NOT NULL DEFAULT '/', release TEXT NOT NULL DEFAULT 'dev', started_at INTEGER NOT NULL, last_at INTEGER NOT NULL, event_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, detail TEXT NOT NULL, chunk_key TEXT, UNIQUE(session_id,seq));
      CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), fingerprint TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, UNIQUE(project_id,fingerprint));
      CREATE TABLE IF NOT EXISTS issue_events (issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, PRIMARY KEY(issue_id,event_id));
      CREATE TABLE IF NOT EXISTS diagnoses (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, mode TEXT NOT NULL, status TEXT NOT NULL, report TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reproductions (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, status TEXT NOT NULL, script TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_by_time ON sessions(project_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS event_by_time ON events(session_id, seq);
      CREATE INDEX IF NOT EXISTS issue_recent ON issues(last_seen DESC);
    `);
    this.db.prepare('INSERT OR IGNORE INTO projects VALUES (?, ?, ?, ?)').run('demo', 'BugRewind Demo', 'demo-public-key', Date.now());
  }
  close() { this.db.close(); }
  project(key) { return this.db.prepare('SELECT * FROM projects WHERE public_key=?').get(key); }
  ingest(payload) {
    assert(payload && typeof payload === 'object', 'Invalid payload');
    assert(typeof payload.projectKey === 'string' && payload.projectKey.length < 120, 'Invalid project key');
    const project = this.project(payload.projectKey);
    assert(project, 'Unknown project key', 403);
    assert(typeof payload.sessionId === 'string' && /^[a-f0-9-]{36}$/i.test(payload.sessionId), 'Invalid sessionId');
    assert(Array.isArray(payload.events) && payload.events.length <= 60 && payload.events.length > 0, 'Expected up to 60 events');
    const session = payload.sessionId;
    const now = Date.now();
    const prepared = payload.events.map(event => {
      assert(event && Number.isSafeInteger(event.seq) && event.seq >= 0, 'Invalid event sequence');
      assert(Number.isSafeInteger(event.at) && event.at > 0 && event.at < now + 60000, 'Invalid event timestamp');
      assert(['snapshot','click','route','scroll','network','error','note'].includes(event.kind), 'Unsupported event kind');
      if (event.kind === 'snapshot') {
        assert(typeof event.snapshot === 'string' && Buffer.byteLength(event.snapshot) <= 40000, 'Snapshot too large');
        assert(!/<\s*(script|iframe|object|embed|form|input|textarea|select|link|meta|style)\b/i.test(event.snapshot), 'Unsafe replay markup');
        assert(!/\bon\w+\s*=|javascript:|(?:src|href)\s*=/i.test(event.snapshot), 'Unsafe replay attributes');
      }
      return {seq:event.seq, at:event.at, kind:event.kind, label:short(redactLabel(event.label),150), detail:JSON.stringify(safeDetail(event.detail || {})), snapshot:event.kind==='snapshot'?event.snapshot:null};
    });
    let accepted = 0;
    const written = [];
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT OR IGNORE INTO sessions(id,project_id,route,release,started_at,last_at) VALUES (?,?,?,?,?,?)')
        .run(session, project.id, short(payload.route||'/',160), short(payload.release||'dev',60), now, now);
      const owner = this.db.prepare('SELECT project_id FROM sessions WHERE id=?').get(session);
      assert(owner.project_id === project.id, 'Session belongs to another project', 403);
      const insert = this.db.prepare('INSERT OR IGNORE INTO events(session_id,seq,at,kind,label,detail,chunk_key) VALUES (?,?,?,?,?,?,?)');
      for (const event of prepared) {
        let key = null;
        if (event.snapshot) {
          key = path.join('chunks', session + '-' + event.seq + '.json.gz');
          const full = path.join(this.dataDir,key);
          if (!fs.existsSync(full)) { fs.writeFileSync(full, zlib.gzipSync(JSON.stringify({html:event.snapshot}))); written.push(full); }
        }
        const r = insert.run(session,event.seq,event.at,event.kind,event.label,event.detail,key);
        if (!r.changes) continue;
        accepted++;
        if (event.kind==='error' || (event.kind==='network' && JSON.parse(event.detail).status >= 500)) {
          const fp=fingerprint(event.kind,event.label), issueId='iss_'+fp;
          this.db.prepare(`INSERT INTO issues(id,project_id,fingerprint,title,kind,occurrences,first_seen,last_seen)
            VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(project_id,fingerprint) DO UPDATE SET occurrences=occurrences+1,last_seen=excluded.last_seen`)
            .run(issueId,project.id,fp,event.label,event.kind,event.at,event.at);
          this.db.prepare('INSERT OR IGNORE INTO issue_events(issue_id,event_id) VALUES (?,?)').run(issueId,Number(r.lastInsertRowid));
        }
      }
      this.db.prepare('UPDATE sessions SET last_at=?,event_count=(SELECT count(*) FROM events WHERE session_id=?) WHERE id=?').run(now,session,session);
      this.db.exec('COMMIT');
    } catch(error) {
      this.db.exec('ROLLBACK');
      for(const f of written) { try {fs.unlinkSync(f);}catch {} }
      throw error;
    }
    return { accepted, sessionId:session };
  }
  summary(){
    const one=q=>this.db.prepare(q).get().n;
    return {sessions:one('SELECT count(*) n FROM sessions'),issues:one('SELECT count(*) n FROM issues'),errors:one("SELECT count(*) n FROM events WHERE kind='error'"),networkFailures:one("SELECT count(*) n FROM events WHERE kind='network' AND json_extract(detail,'$.status') >= 500")};
  }
  sessions(){return this.db.prepare(`SELECT s.*, (SELECT count(*) FROM events e WHERE e.session_id=s.id AND e.kind='error') AS errors FROM sessions s ORDER BY s.last_at DESC LIMIT 100`).all();}
  session(id){return this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);}
  events(sessionId){return this.db.prepare('SELECT id,seq,at,kind,label,detail,chunk_key FROM events WHERE session_id=? ORDER BY seq LIMIT 2000').all(sessionId).map(e=>({...e,detail:JSON.parse(e.detail),chunk_key:undefined,hasSnapshot:!!e.chunk_key}));}
  snapshot(sessionId,seq){
    const e=this.db.prepare("SELECT chunk_key FROM events WHERE session_id=? AND seq=? AND kind='snapshot'").get(sessionId,seq);
    if(!e)return null;
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(this.dataDir,e.chunk_key))).toString());
  }
  issues(){return this.db.prepare('SELECT * FROM issues ORDER BY last_seen DESC LIMIT 100').all();}
  issue(issueId){
    const issue=this.db.prepare('SELECT * FROM issues WHERE id=?').get(issueId);
    if(!issue)return null;
    const events=this.db.prepare(`SELECT e.id,e.seq,e.session_id,e.at,e.kind,e.label,e.detail FROM events e JOIN issue_events x ON x.event_id=e.id WHERE x.issue_id=? ORDER BY e.at DESC LIMIT 50`).all(issueId).map(e=>({...e,detail:JSON.parse(e.detail)}));
    return {...issue,events};
  }
  context(issueId){
    const issue=this.issue(issueId);
    if(!issue)return null;
    const sessions=[...new Set(issue.events.slice(0,4).map(e=>e.session_id))];
    const neighborhood=[];
    for(const sessionId of sessions){
      const target=issue.events.find(e=>e.session_id===sessionId);
      const rows=this.db.prepare(`SELECT id,session_id,seq,at,kind,label,detail FROM events WHERE session_id=? AND at BETWEEN ? AND ? AND kind!='snapshot' ORDER BY at LIMIT 50`).all(sessionId,target.at-15000,target.at+3000);
      neighborhood.push(...rows.map(e=>({...e,detail:JSON.parse(e.detail)})));
    }
    return {issue,events:neighborhood};
  }
  saveDiagnosis(issueId,mode,status,report){
    const diagnosis={id:id(),issueId,mode,status,report,createdAt:Date.now()};
    this.db.prepare('INSERT INTO diagnoses VALUES(?,?,?,?,?,?)').run(diagnosis.id,issueId,mode,status,JSON.stringify(report),diagnosis.createdAt);
    return diagnosis;
  }
  diagnoses(issueId){return this.db.prepare('SELECT * FROM diagnoses WHERE issue_id=? ORDER BY created_at DESC LIMIT 20').all(issueId).map(r=>({...r,report:JSON.parse(r.report)}));}
  saveRepro(issueId,script,status='draft',result={}) {
    const run={id:id(),issueId,createdAt:Date.now(),status,script,result};
    this.db.prepare('INSERT INTO reproductions VALUES(?,?,?,?,?,?)').run(run.id,issueId,status,script,JSON.stringify(result),run.createdAt);
    return run;
  }
  reproduction(id){const r=this.db.prepare('SELECT * FROM reproductions WHERE id=?').get(id);return r?{...r,result:JSON.parse(r.result)}:null;}
  updateRepro(id,status,result){this.db.prepare('UPDATE reproductions SET status=?,result=? WHERE id=?').run(status,JSON.stringify(result),id);return this.reproduction(id);}
  deleteSession(id){
    const rows=this.db.prepare('SELECT chunk_key FROM events WHERE session_id=? AND chunk_key IS NOT NULL').all(id);
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    for(const row of rows){try{fs.unlinkSync(path.join(this.dataDir,row.chunk_key));}catch{}}
    this.db.exec(`DELETE FROM issues WHERE NOT EXISTS (SELECT 1 FROM issue_events WHERE issue_events.issue_id=issues.id)`);
    this.db.exec(`UPDATE issues SET occurrences=(SELECT count(*) FROM issue_events WHERE issue_events.issue_id=issues.id), first_seen=(SELECT min(e.at) FROM issue_events x JOIN events e ON e.id=x.event_id WHERE x.issue_id=issues.id), last_seen=(SELECT max(e.at) FROM issue_events x JOIN events e ON e.id=x.event_id WHERE x.issue_id=issues.id)`);
  }
  retention(days=7){
    const maxAge=Date.now()-days*86400000;
    const ids=this.db.prepare('SELECT id FROM sessions WHERE last_at < ?').all(maxAge).map(x=>x.id);
    ids.forEach(id=>this.deleteSession(id));return ids.length;
  }
}
function redactLabel(text){return String(text||'event').replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g,'[email]').replace(/(?:sk-[\w-]+|gh[pousr]_[\w-]+)/g,'[token]');}
