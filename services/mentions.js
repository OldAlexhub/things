import {Mention,MentionCheck} from '../models/index.js';
export const HASHTAG='old_alex_hub';
export const mentionLinks=[
  ['Instagram','https://www.instagram.com/explore/tags/old_alex_hub/'],
  ['TikTok','https://www.tiktok.com/tag/old_alex_hub'],
  ['Facebook','https://www.facebook.com/hashtag/old_alex_hub'],
  ['X','https://x.com/search?q=%23old_alex_hub&f=live'],
  ['Bluesky','https://bsky.app/search?q=%23old_alex_hub'],
  ['Mastodon','https://mastodon.social/tags/old_alex_hub'],
  ['Google','https://www.google.com/search?q=%22%23old_alex_hub%22'],
];
export function exactHashtag(text) {return /(?:^|[^\p{L}\p{N}_])#old_alex_hub(?![\p{L}\p{N}_])/iu.test(text || '');}
const plain=text=>String(text||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
export function blueskyMentions(data) {
  return (data.posts || []).filter(p=>exactHashtag(p.record?.text)).flatMap(p=>{
    const match=/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([a-z0-9]+)$/i.exec(p.uri||'');
    if(!match)return [];
    return [{url:`https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${match[2]}`,source:'Bluesky',author:String(p.author?.handle||'').slice(0,160),excerpt:plain(p.record.text).slice(0,300),postedAt:new Date(p.record.createdAt),likes:p.likeCount||0,reposts:p.repostCount||0}];
  });
}
export function mastodonMentions(data) {
  return (Array.isArray(data)?data:[]).filter(p=>p.visibility==='public' && !p.reblog && (p.tags||[]).some(t=>t.name?.toLowerCase()===HASHTAG))
    .filter(p=>safeURL(p.url)).map(p=>({url:safeURL(p.url),source:'Mastodon',author:String(p.account?.acct||'').slice(0,160),excerpt:plain(p.content).slice(0,300),postedAt:new Date(p.created_at),likes:p.favourites_count||0,reposts:p.reblogs_count||0}));
}
const sources=[
  {name:'Bluesky',url:`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%23${HASHTAG}&sort=latest&limit=100`,parse:blueskyMentions},
  {name:'Mastodon',url:`https://mastodon.social/api/v1/timelines/tag/${HASHTAG}?limit=40`,parse:mastodonMentions},
];
let running=false;
export async function checkMentions({force=false,fetcher=fetch}={}) {
  if(running || (process.env.HASHTAG_TRACKING_ENABLED??'true')!=='true')return;
  running=true;
  try {
    for(const source of sources) {
      const previous=await MentionCheck.findOne({source:source.name}).lean();
      if(previous?.checkedAt && Date.now()-new Date(previous.checkedAt).getTime()<(force?60000:3600000))continue;
      const now=new Date();
      try {
        const r=await fetcher(source.url,{headers:{'User-Agent':'ThingsToDo/1.2 (info@oldalexhub.com)'},signal:AbortSignal.timeout(15000),redirect:'error'});
        if(!r.ok)throw new Error(`Public API returned HTTP ${r.status}. Public access may be restricted.`);
        const records=source.parse(await r.json());
        for(const record of records) {
          if(!Number.isFinite(+record.postedAt))continue;
          await Mention.updateOne({url:record.url},{$set:{...record,lastSeenAt:now,expireAt:new Date(+now+30*86400000)}},{upsert:true});
        }
        await MentionCheck.updateOne({source:source.name},{$set:{checkedAt:now,lastSuccessAt:now,status:'ok',found:records.length,message:source.name==='Mastodon'?'Latest public posts visible to mastodon.social; not the entire fediverse.':'Latest indexed public search results; not every post is indexed.'}},{upsert:true});
      }catch(error){await MentionCheck.updateOne({source:source.name},{$set:{checkedAt:now,status:'unavailable',message:error.message}},{upsert:true});}
    }
  } finally {running=false;}
}
export async function mentionDashboard() {
  return {hashtag:'#'+HASHTAG,enabled:(process.env.HASHTAG_TRACKING_ENABLED??'true')==='true',
    checks:await MentionCheck.find().lean(),links:mentionLinks,
    mentions:await Mention.find({hidden:{$ne:true},expireAt:{$gt:new Date()}}).sort({postedAt:-1,createdAt:-1}).limit(100).lean(),
    coverage:'Automatic hourly checks cover recent public results on Bluesky and mastodon.social. Search links let you check other sites and save public post URLs. Private, unindexed, deleted or restricted posts cannot be counted. These are observed mentions, not impressions, reach or ad revenue.',
  };
}
export function startMentionMonitor() {
  const run=()=>checkMentions().catch(()=>console.error(JSON.stringify({event:'hashtag_check_failed'})));
  void run(); const timer=setInterval(run,3600000);timer.unref();return ()=>clearInterval(timer);
}
