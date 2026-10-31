const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let createAuthService, safeReturnPath;
before(async()=>{({createAuthService,safeReturnPath}=await import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../../shared/auth-core.js')).toString('base64')));});
function memory(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function setup(overrides={}){
  const local=memory(),tab=memory();const calls=[];let session=null,google=true,exchangeError=null;
  const location={origin:'https://create.kapework.com',pathname:'/myplan/',href:'https://create.kapework.com/myplan/',assign:url=>calls.push(['navigate',url])};
  const client = { auth: {
    getSession: async () => ({ data: { session } }),
    setSession: async value => { calls.push(['adopt', value]); session = { user: { id: 'old-account' } }; return { data: { session } }; },
    signInWithOAuth: async value => { calls.push(['oauth', value]); return { data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' } }; },
    exchangeCodeForSession: async code => { calls.push(['exchange', code]); return exchangeError ? { error: exchangeError } : { data: { session: { user: { id: 'google-account' } } } }; },
    signOut: async options => { calls.push(['signOut', options]); session = null; return {}; },
    onAuthStateChange: callback => {
      callback('INITIAL_SESSION', session);
      return { data: { subscription: { unsubscribe() { calls.push(['unsubscribe']); } } } };
    },
  } };
  const service=createAuthService({createClient:(...args)=>{calls.push(['client',...args]);return client;},getConfig:()=>({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public-test-key'}),location,localStorage:local,sessionStorage:tab,fetch:async()=>({ok:true,json:async()=>({external:{google}})}),now:()=>100000,...overrides});
  return {service,local,tab,calls,location,client,setSession:value=>session=value,setGoogle:value=>google=value,setExchangeError:value=>exchangeError=value};
}
test('return routes stay on the current origin and strip auth response values',()=>{
  for(const bad of ['https://evil.test/x','//evil.test/x','javascript:alert(1)','/\\evil.test','/%5c%5cevil.test','/shared/auth/callback.html'])assert.equal(safeReturnPath(bad,'https://create.kapework.com'),'/');
  assert.equal(safeReturnPath('/myplan/?code=private&view=library#access_token=private','https://create.kapework.com'),'/myplan/?view=library');
  assert.equal(safeReturnPath('/make24/#practice','https://create.kapework.com'),'/make24/#practice');
});
test('concurrent consumers receive one PKCE client',async()=>{const f=setup();const clients=await Promise.all([f.service.getClient(),f.service.getClient()]);assert.equal(clients[0],clients[1]);const calls=f.calls.filter(c=>c[0]==='client');assert.equal(calls.length,1);assert.equal(calls[0][3].auth.flowType,'pkce');});
test('Google redirects through this origin callback with a safe stored return path',async()=>{const f=setup();await f.service.signInWithGoogle();const oauth=f.calls.find(c=>c[0]==='oauth')[1];assert.equal(oauth.provider,'google');assert.equal(oauth.options.redirectTo,'https://create.kapework.com/shared/auth/callback.html');assert.equal(oauth.options.skipBrowserRedirect,true);assert.equal(JSON.parse(f.tab.getItem('kapework:auth:return')).path,'/myplan/');assert.equal(f.calls.filter(c=>c[0]==='navigate').length,1);});
test('disabled Google provider leaves user on app and does not call OAuth',async()=>{const f=setup();f.setGoogle(false);await assert.rejects(f.service.signInWithGoogle(),/not available/);assert.equal(f.calls.some(c=>c[0]==='oauth'),false);});
test('existing shared account is not replaced by a legacy My Plan account',async()=>{const f=setup();f.local.setItem('kapework-myplan-auth',JSON.stringify({access_token:'legacy-access',refresh_token:'legacy-refresh'}));f.setSession({user:{id:'selected-account'}});await f.service.getClient();assert.equal(f.calls.some(c=>c[0]==='adopt'),false);assert.equal(f.local.getItem('kapework-myplan-auth'),null);});
test('legacy session is migrated once and cannot resurrect after sign-out',async()=>{const f=setup();f.local.setItem('kapework-myplan-auth',JSON.stringify({access_token:'legacy-access',refresh_token:'legacy-refresh'}));await f.service.getClient();assert.equal(f.calls.filter(c=>c[0]==='adopt').length,1);await f.service.signOut();assert.equal(f.local.getItem('kapework-myplan-auth'),null);assert.equal(f.local.getItem('kapework:auth:myplan-migrated'),'1');assert.deepEqual(f.calls.find(c=>c[0]==='signOut')[1],{scope:'local'});});
test('callback exchanges its own code before legacy migration and consumes return route once',async()=>{const f=setup();f.location.pathname='/shared/auth/callback.html';f.local.setItem('kapework-myplan-auth',JSON.stringify({access_token:'legacy-access',refresh_token:'legacy-refresh'}));f.tab.setItem('kapework:auth:return',JSON.stringify({path:'/myplan/',createdAt:90000}));assert.deepEqual(await f.service.finishSignIn({code:'one-use-code'}),{ok:true,path:'/myplan/'});assert.equal(f.calls.some(c=>c[0]==='adopt'),false);assert.equal(f.calls.find(c=>c[0]==='client')[3].auth.detectSessionInUrl,false);assert.equal(f.tab.getItem('kapework:auth:return'),null);assert.equal(f.tab.getItem('kapework:auth:completed'),'1');});
test('cancelled or failed callback never uses an old signed-in session as success',async()=>{const f=setup();f.setSession({user:{id:'existing-account'}});assert.equal((await f.service.finishSignIn({error:'access_denied'})).ok,false);assert.equal(f.calls.some(c=>c[0]==='exchange'),false);f.setExchangeError(new Error('private token must not appear'));const result=await f.service.finishSignIn({code:'expired'});assert.equal(result.ok,false);assert.equal(result.message.includes('private token'),false);});
test('expired or manipulated return routes safely go home',async()=>{const f=setup();f.tab.setItem('kapework:auth:return',JSON.stringify({path:'https://evil.test/',createdAt:1}));assert.equal((await f.service.finishSignIn({code:'valid'})).path,'/');});
test('auth subscribers run after SDK auth callback releases its lock',async()=>{const f=setup();let called=false;const unsubscribe=await f.service.subscribe(()=>called=true);assert.equal(called,false);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(called,true);unsubscribe();assert.equal(f.calls.at(-1)[0],'unsubscribe');});
