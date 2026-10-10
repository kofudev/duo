const test = require('node:test');
const assert = require('node:assert/strict');
const { isClaudeSubscription } = require('../electron/providers.cjs');
test('Claude subscription status does not mistake Console OAuth or cloud credentials for subscription', () => {
  assert.equal(
    isClaudeSubscription({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }),
    true
  );
  assert.equal(
    isClaudeSubscription({ loggedIn: true, authMethod: 'oauth', subscriptionType: 'max' }),
    true
  );
  assert.equal(
    isClaudeSubscription({ loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty' }),
    true
  );
  assert.equal(isClaudeSubscription({ loggedIn: true, authMethod: 'oauth' }), false);
  assert.equal(
    isClaudeSubscription({ loggedIn: true, authMethod: 'api_key', subscriptionType: 'pro' }),
    false
  );
  assert.equal(
    isClaudeSubscription({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' }),
    false
  );
  assert.equal(isClaudeSubscription({ loggedIn: false, authMethod: 'claude.ai' }), false);
});
