import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exactHashtag,blueskyMentions,mastodonMentions} from '../services/mentions.js';
test('hashtag matches are exact and case insensitive, not substring brand guesses',()=>{
  assert.ok(exactHashtag('I was here! #OLD_ALEX_HUB'));
  for(const value of ['old_alex_hub','#old_alex_hub_extra','#old_alex_hub2','word#old_alex_hub'])assert.equal(exactHashtag(value),false);
});
test('Bluesky records link to actual public posts and exclude untagged posts',()=>{
  const record={uri:'at://did:plc:example/app.bsky.feed.post/abc123',author:{handle:'qa.test'},record:{text:'#old_alex_hub',createdAt:'2026-11-15T00:00:00Z'},likeCount:2};
  const rows=blueskyMentions({posts:[record,{...record,record:{text:'old_alex_hub'}}]});
  assert.equal(rows.length,1);assert.equal(rows[0].likes,2);assert.ok(rows[0].url.startsWith('https://bsky.app/profile/'));
});
test('Mastodon ignores private posts and reposts and strips HTML before storage',()=>{
  const post={visibility:'public',tags:[{name:'old_alex_hub'}],url:'https://mastodon.social/@qa/123',content:'<p>A memory &amp; #old_alex_hub</p>',account:{acct:'qa'},created_at:'2026-11-15T00:00:00Z'};
  const rows=mastodonMentions([post,{...post,visibility:'private'},{...post,reblog:post},{...post,url:'javascript:alert(1)'}]);
  assert.equal(rows.length,1);assert.equal(rows[0].excerpt,'A memory & #old_alex_hub');
});
