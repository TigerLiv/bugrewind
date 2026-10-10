// Reproduction Lab only targets the built-in demo route; never executes arbitrary user-provided code.
export function makeDraft(issue, baseUrl='http://127.0.0.1:4177') {
  const isNetwork=issue.kind==='network' || /HTTP\s*500|save|保存/i.test(issue.title);
  const note=isNetwork?'失败请求与错误状态':'运行时异常';
  const script=`import { test, expect } from '@playwright/test';

// Generated draft for issue ${issue.id}; REVIEW BEFORE EXECUTION.
// This reproduces the local synthetic Demo App, not the original user session.
test('BugRewind ${note} scenario', async ({ page }) => {
  await page.goto('${baseUrl}/demo');
  await page.getByTestId('start-capture').click();
  await page.getByTestId('${isNetwork?'save-error':'throw-error'}').click();
  ${isNetwork?"await expect(page.getByTestId('demo-status')).toContainText('保存失败');":"await expect(page.getByTestId('demo-status')).toContainText('错误已触发');"}
});
`;
  return {script,scenario:isNetwork?'api500':'runtimeError',caveat:'此代码是受控 Demo 的测试草稿，不能证明原始生产故障已重现。'};
}
export async function verifyDemo(baseUrl, scenario) {
  if(scenario==='api500'){
    const res=await fetch(baseUrl+'/api/demo/save',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const body=await res.json();
    return {status:res.status===500&&body.code==='DEMO_FAILURE'?'passed':'failed',checks:[{name:'Synthetic demo save endpoint returns expected HTTP 500',passed:res.status===500&&body.code==='DEMO_FAILURE'}],method:'HTTP contract check',limitations:['该任务只验证受控 Demo API；没有运行浏览器的 Playwright 测试，也没有验证生产故障。']};
  }
  return {status:'not_executed',checks:[],method:'draft only',limitations:['浏览器异常需要 Playwright 浏览器执行器；当前版本仅生成测试草稿。']};
}
