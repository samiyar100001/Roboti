import test from 'node:test';
import assert from 'node:assert/strict';
import { runFullVerificationSuite } from './verificationSuite';

test('Section 6.2 Master Prompt Automated Verification Suite (Tests A through L)', async () => {
  const report = await runFullVerificationSuite();
  for (const item of report.results) {
    assert.equal(
      item.passed,
      true,
      `${item.testId} (${item.title}) failed: ${item.details}`
    );
  }
  assert.equal(report.totalTests, 12);
  assert.equal(report.passedCount, 12);
  assert.equal(report.failedCount, 0);
  assert.ok(report.totalAssertions >= 100);
});
