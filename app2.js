// IndexedDB for GLB blob persistence
var _db=null;
function openDB(){
  return new Promise(function(resolve){
    if(_db){resolve(_db);return;}
    var req=indexedDB.open('relicDB',2);
    req.onupgradeneeded=function(e){
      var db=e.target.result;
      if(!db.objectStoreNames.contains('glbFiles'))db.createObjectStore('glbFiles',{keyPath:'key'});
      if(!db.objectStoreNames.contains('imgFiles'))db.createObjectStore('imgFiles',{keyPath:'key'});
    };
    req.onsuccess=function(e){_db=e.target.result;resolve(_db);};
    req.onerror=function(){resolve(null);};
  });
}
function idbSave(store,key,blob){
  return openDB().then(function(db){
    if(!db)return;
    return new Promise(function(resolve){
      var tx=db.transaction(store,'readwrite');
      tx.objectStore(store).put({key:key,blob:blob});
      tx.oncomplete=function(){resolve(true);};
      tx.onerror=function(){resolve(false);};
    });
  });
}
function idbLoad(store,key){
  return openDB().then(function(db){
    if(!db)return null;
    return new Promise(function(resolve){
      var tx=db.transaction(store,'readonly');
      var req=tx.objectStore(store).get(key);
      req.onsuccess=function(){resolve(req.result?req.result.blob:null);};
      req.onerror=function(){resolve(null);};
    });
  });
}
function idbDelete(store,key){
  return openDB().then(function(db){
    if(!db)return;
    var tx=db.transaction(store,'readwrite');
    tx.objectStore(store).delete(key);
  });
}

// localStorage for relic metadata persistence
var USER_RELICS_KEY='userRelics_v1';
var REG_USERS_KEY='regUsers_v1';
var LOGIN_KEY='loginUser_v1';
var RELIC_OVERRIDES_KEY='relicOverrides_v1';
var LIBS_KEY='libs_v1';
var USERS_KEY='allUsers_v1';

// --- Netlify Cloud Sync: primary backend for data sync (no token needed) ---
var NETLIFY_API_KEY='netlifyApiUrl_v1';
var _netlifyApiUrl='';

function loadNetlifyConfig(){
  try{
    var s=localStorage.getItem(NETLIFY_API_KEY);
    if(s)return s;
  }catch(e){}
  return '';
}
function saveNetlifyConfig(url){
  try{localStorage.setItem(NETLIFY_API_KEY,url);}catch(e){}
}
function getNetlifyApiUrl(){
  // Auto-detect if hosted on Netlify
  if(!_netlifyApiUrl){
    var saved=loadNetlifyConfig();
    if(saved){
      _netlifyApiUrl=saved;
    }else if(window.location.hostname.indexOf('netlify.app')>=0){
      _netlifyApiUrl='https://'+window.location.hostname+'/.netlify/functions/api/';
    }
  }
  return _netlifyApiUrl;
}
function hasNetlifyBackend(){
  return getNetlifyApiUrl().length>0;
}

// Pull from Netlify API
function pullKeyFromNetlify(key,callback){
  var url=getNetlifyApiUrl();
  if(!url){if(callback)callback(false);return;}
  fetch(url+key+'?t='+Date.now(),{cache:'no-store'}).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(res){
    try{
      if(res&&res.ok&&res.data!==null&&res.data!==undefined){
        var serverData=res.data;
        if(typeof serverData==='string'){
          try{serverData=JSON.parse(serverData);}catch(e){}
        }
        var merged=mergeServerData(key,serverData);
        localStorage.setItem(key,JSON.stringify(merged));
        if(callback)callback(true);
      }else{
        // No data on server, keep local
        if(callback)callback(true);
      }
    }catch(e){
      if(callback)callback(false);
    }
  }).catch(function(){
    if(callback)callback(false);
  });
}

// Push to Netlify API
function pushKeyToNetlify(key,callback){
  var url=getNetlifyApiUrl();
  if(!url){if(callback)callback(false,'no api url');return;}
  var val=localStorage.getItem(key);
  if(val===null){if(callback)callback(false,'no local data');return;}
  fetch(url+key,{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:val
  }).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(res){
    if(res&&res.ok){
      if(callback)callback(true);
    }else{
      if(callback)callback(false,res.error||'push failed');
    }
  }).catch(function(e){
    if(callback)callback(false,e.message);
  });
}

// --- GitHub Cloud Sync: data stored in GitHub repo, accessible from any device ---
var GH_CONFIG_KEY='ghConfig_v1';
var _syncKeys=[USER_RELICS_KEY,REG_USERS_KEY,RELIC_OVERRIDES_KEY,LIBS_KEY,USERS_KEY];
var _syncTimer=null;
var _ghCache={}; // cache file SHAs for faster updates
var _autoPullTimer=null;

function loadGhConfig(){
  try{
    var s=localStorage.getItem(GH_CONFIG_KEY);
    if(s)return JSON.parse(s);
  }catch(e){}
  // Default config based on current repo (can be changed by user)
  return {
    owner:'JustXylia',
    repo:'relic-restoration-db',
    branch:'main',
    dataDir:'data',
    token:''
  };
}
function saveGhConfig(cfg){
  try{localStorage.setItem(GH_CONFIG_KEY,JSON.stringify(cfg));}catch(e){}
}
function hasGhToken(){
  var cfg=loadGhConfig();
  return cfg.token&&cfg.token.length>0;
}
function getGhRawUrl(key){
  var cfg=loadGhConfig();
  return 'https://raw.githubusercontent.com/'+cfg.owner+'/'+cfg.repo+'/'+cfg.branch+'/'+cfg.dataDir+'/'+key+'.json?t='+Date.now();
}
function getGhApiUrl(key){
  var cfg=loadGhConfig();
  return 'https://api.github.com/repos/'+cfg.owner+'/'+cfg.repo+'/contents/'+cfg.dataDir+'/'+key+'.json';
}

// Merge server data into local data — never overwrite local changes
function mergeServerData(key, serverData){
  var localRaw=localStorage.getItem(key);
  var localData=null;
  try{if(localRaw)localData=JSON.parse(localRaw);}catch(e){localData=null;}
  
  // If local is empty, just use server data
  if(!localData||(Array.isArray(localData)&&localData.length===0)||(typeof localData==='object'&&Object.keys(localData).length===0)){
    return serverData;
  }
  // If server is empty/null, keep local data
  if(!serverData||(Array.isArray(serverData)&&serverData.length===0)||(typeof serverData==='object'&&Object.keys(serverData).length===0)){
    return localData;
  }
  
  // For arrays — merge by id (relics/users/libs)
  if(Array.isArray(localData)&&Array.isArray(serverData)){
    var idKey='id';
    if(key===USERS_KEY||key===REG_USERS_KEY)idKey='workId';
    var map={};
    localData.forEach(function(item){if(item&&item[idKey])map[item[idKey]]=item;});
    serverData.forEach(function(item){
      if(item&&item[idKey]&&!map[item[idKey]]){
        map[item[idKey]]=item;
      }
    });
    return Object.values(map);
  }
  
  // For objects — merge keys, local values take precedence
  if(typeof localData==='object'&&typeof serverData==='object'&&!Array.isArray(localData)&&!Array.isArray(serverData)){
    var merged={};
    for(var sk in serverData){merged[sk]=serverData[sk];}
    for(var lk in localData){merged[lk]=localData[lk];}
    return merged;
  }
  
  // Default: keep local
  return localData;
}

// Pull single key from GitHub (read-only, no token needed for public repos)
function pullKeyFromGh(key,callback){
  fetch(getGhRawUrl(key),{cache:'no-store'}).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.text();
  }).then(function(text){
    try{
      var serverData=JSON.parse(text);
      // Merge with local data instead of overwriting
      var merged=mergeServerData(key,serverData);
      localStorage.setItem(key,JSON.stringify(merged));
      if(callback)callback(true);
    }catch(e){
      if(callback)callback(false);
    }
  }).catch(function(){
    if(callback)callback(false);
  });
}

// Push single key to GitHub (needs token)
function pushKeyToGh(key,callback){
  var cfg=loadGhConfig();
  if(!cfg.token){if(callback)callback(false,'no token');return;}
  
  var val=localStorage.getItem(key);
  if(val===null){if(callback)callback(false,'no local data');return;}
  
  var url=getGhApiUrl(key);
  var content=b64EncodeUnicode(val);
  
  // First get the SHA of existing file (if any)
  fetch(url+'?ref='+cfg.branch,{
    headers:{'Authorization':'token '+cfg.token,'Accept':'application/vnd.github.v3+json'}
  }).then(function(r){
    if(r.status===404)return null; // file doesn't exist yet
    if(!r.ok)throw new Error('GET failed: '+r.status);
    return r.json();
  }).then(function(existing){
    var payload={
      message:'Update '+key+' data',
      content:content,
      branch:cfg.branch
    };
    if(existing&&existing.sha){
      payload.sha=existing.sha;
      _ghCache[key]=existing.sha;
    }
    
    return fetch(url,{
      method:'PUT',
      headers:{
        'Authorization':'token '+cfg.token,
        'Accept':'application/vnd.github.v3+json',
        'Content-Type':'application/json'
      },
      body:JSON.stringify(payload)
    });
  }).then(function(r){
    if(!r.ok)throw new Error('PUT failed: '+r.status);
    return r.json();
  }).then(function(result){
    if(result&&result.content&&result.content.sha){
      _ghCache[key]=result.content.sha;
    }
    if(callback)callback(true);
  }).catch(function(e){
    if(callback)callback(false,e.message);
  });
}

// Helper: UTF-8 safe base64 encode
function b64EncodeUnicode(str){
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,function(match,p1){
    return String.fromCharCode('0x'+p1);
  }));
}

// Sync all keys to server (debounced)
// Priority: Netlify first, then GitHub (if token configured)
function syncToServer(){
  if(!hasNetlifyBackend()&&!hasGhToken())return; // no backend available
  if(_syncTimer)clearTimeout(_syncTimer);
  _syncTimer=setTimeout(function(){
    _syncKeys.forEach(function(k){
      if(hasNetlifyBackend()){
        pushKeyToNetlify(k,function(){});
      }
      if(hasGhToken()){
        pushKeyToGh(k,function(){});
      }
    });
  },500);
}

// Pull all keys from server
// Priority: Netlify first, then GitHub as fallback
function syncAllFromServer(callback){
  var pending=_syncKeys.length;
  var done=0;
  _syncKeys.forEach(function(k){
    var pullFn=hasNetlifyBackend()?pullKeyFromNetlify:pullKeyFromGh;
    pullFn(k,function(ok){
      done++;
      if(done===pending&&callback)callback();
    });
  });
}

// Auto-pull: check for updates every 30 seconds
function startAutoPull(){
  if(_autoPullTimer)clearInterval(_autoPullTimer);
  _autoPullTimer=setInterval(function(){
    syncAllFromServer(function(){});
  },30000);
}

// Initialize: try to pull on startup (best-effort)
try{
  syncAllFromServer(function(){});
  startAutoPull();
}catch(e){}

function saveUserRelics(relics){
  try{localStorage.setItem(USER_RELICS_KEY,JSON.stringify(relics));}catch(e){console.error('Save failed:',e);}
  syncToServer();
}
function loadUserRelics(){
  try{var s=localStorage.getItem(USER_RELICS_KEY);if(!s)return[];
    var arr=JSON.parse(s);
    arr.forEach(function(r){
      if(r.imgBefore&&r.imgBefore.indexOf('blob:')===0)r.imgBefore='';
      if(r.imgCleaned&&r.imgCleaned.indexOf('blob:')===0)r.imgCleaned='';
      if(r.imgDuring&&r.imgDuring.indexOf('blob:')===0)r.imgDuring='';
      if(r.imgAfter&&r.imgAfter.indexOf('blob:')===0)r.imgAfter='';
      if(r.glbUnrestored&&r.glbUnrestored.indexOf('blob:')===0)r.glbUnrestored='';
      if(r.glbRestored&&r.glbRestored.indexOf('blob:')===0)r.glbRestored='';
    });
    return arr;
  }catch(e){return[];}
}
function saveRegUsers(users){
  try{localStorage.setItem(REG_USERS_KEY,JSON.stringify(users));}catch(e){}
  syncToServer();
}
function loadRegUsers(){
  try{var s=localStorage.getItem(REG_USERS_KEY);return s?JSON.parse(s):[];}catch(e){return[];}
}
function saveLoginUser(user){
  try{localStorage.setItem(LOGIN_KEY,JSON.stringify({name:user.name,nickname:user.nickname,roleId:user.role,roleName:user.roleName,workId:user.workId,scope:user.scope,perms:user.perms}));}catch(e){}
  syncToServer();
}
function loadLoginUser(){
  try{var s=localStorage.getItem(LOGIN_KEY);return s?JSON.parse(s):null;}catch(e){return null;}
}

// Relic overrides: persists changes to generated (non-userUploaded) relics
function loadRelicOverrides(){
  try{var s=localStorage.getItem(RELIC_OVERRIDES_KEY);return s?JSON.parse(s):{};}catch(e){return{};}
}
function saveRelicOverrides(obj){
  try{localStorage.setItem(RELIC_OVERRIDES_KEY,JSON.stringify(obj));}catch(e){console.error('Override save failed:',e);}
  syncToServer();
}
function saveRelicOverride(id,fields){
  var all=loadRelicOverrides();
  if(!all[id])all[id]={};
  for(var k in fields){
    if(typeof fields[k]!=='function'&&typeof fields[k]!=='object'){
      all[id][k]=fields[k];
    }else if(typeof fields[k]==='object'&&fields[k]!==null&&Array.isArray(fields[k])){
      all[id][k]=fields[k].slice();
    }
  }
  saveRelicOverrides(all);
}
function deleteRelicOverride(id){
  var all=loadRelicOverrides();
  delete all[id];
  saveRelicOverrides(all);
}

// Library persistence
function saveLibs(libs){
  try{localStorage.setItem(LIBS_KEY,JSON.stringify(libs.map(function(l){return{id:l.id,name:l.name,prefix:l.prefix,desc:l.desc,count:l.count,status:l.status};})));}catch(e){}
  syncToServer();
}
function loadLibs(){
  try{var s=localStorage.getItem(LIBS_KEY);return s?JSON.parse(s):null;}catch(e){return null;}
}

// All users persistence (for nickname changes, new users, status toggles)
function saveAllUsers(users){
  try{localStorage.setItem(USERS_KEY,JSON.stringify(users.map(function(u){
    return{id:u.id,name:u.name,workId:u.workId,nickname:u.nickname,roleId:u.roleId,roleName:u.roleName,department:u.dept||u.department,phone:u.phone,status:u.status,lastLogin:u.lastLogin,scope:u.scope,perms:u.perms};
  })));}catch(e){}
  syncToServer();
}
function loadAllUsers(){
  try{var s=localStorage.getItem(USERS_KEY);return s?JSON.parse(s):null;}catch(e){return null;}
}

// Universal relic change persistence — works for BOTH user-uploaded and generated relics
function saveRelicChange(relic){
  if(!relic)return;
  // Save field overrides for ALL relics (so generated relic changes persist)
  var fields={};
  for(var k in relic){
    if(typeof relic[k]==='function')continue;
    if(typeof relic[k]==='object'&&relic[k]!==null&&!Array.isArray(relic[k]))continue;
    if(k.startsWith('_'))continue;
    fields[k]=relic[k];
  }
  if(relic._glbRestoredIdbKey){fields.glbRestored='idb://glbFiles/'+relic._glbRestoredIdbKey;}
  if(relic._glbUnrestoredIdbKey){fields.glbUnrestored='idb://glbFiles/'+relic._glbUnrestoredIdbKey;}
  saveRelicOverride(relic.id,fields);

  // Also save to user relics if user-uploaded
  if(relic.userUploaded){
    var saved=loadUserRelics();
    var idx=saved.findIndex(function(r){return r.id===relic.id;});
    var copy={};for(var k2 in relic){
      if(typeof relic[k2]==='function')continue;
      if(typeof relic[k2]==='object'&&relic[k2]!==null&&!Array.isArray(relic[k2]))continue;
      if(Array.isArray(relic[k2])){copy[k2]=relic[k2].slice();}
      else{copy[k2]=relic[k2];}
    }
    if(copy._glbRestoredIdbKey){copy.glbRestored='idb://glbFiles/'+copy._glbRestoredIdbKey;}
    if(copy._glbUnrestoredIdbKey){copy.glbUnrestored='idb://glbFiles/'+copy._glbUnrestoredIdbKey;}
    if(idx>=0)saved[idx]=copy;else saved.unshift(copy);
    saveUserRelics(saved);
  }
}

// Legacy alias
function updateUserRelicInStorage(relic){
  saveRelicChange(relic);
}

// Migrate localStorage to new version — preserve user changes (relicOverrides, userRelics)
try{var _v=localStorage.getItem('dataVersion');if(_v!=='v28'){
  // Only clear user list to refresh generated users; keep relic overrides and user relics
  localStorage.removeItem('allUsers_v1');
  localStorage.removeItem('libs_v1');
  localStorage.removeItem('loginUser_v1');
  localStorage.setItem('dataVersion','v28');
}}catch(e){}
function resolveIdbUrl(url){
  if(!url||url.indexOf('idb://')!==0)return Promise.resolve(url);
  var parts=url.substring(6).split('/');
  var store=parts[0];var key=parts[1];
  return idbLoad(store,key).then(function(blob){
    if(!blob)return null;
    return URL.createObjectURL(blob);
  });
}

// Lazy load ECharts only when charts are needed
let echartsLoaded = false;
let echartsReady = null;
function loadEcharts(){
  if(echartsLoaded) return Promise.resolve(window.echarts);
  if(echartsReady) return echartsReady;
  echartsReady = new Promise((resolve)=>{
    const s=document.createElement('script');
    s.src='echarts.min.js';
    s.onload=()=>{echartsLoaded=true;resolve(window.echarts);};
    s.onerror=()=>console.error('ECharts load failed');
    document.head.appendChild(s);
  });
  return echartsReady;
}

const{createApp,ref,reactive,computed,onMounted,nextTick,watch}=Vue;

// Real cultural relic images from Chongqing museums (locally stored)
var _relicImgs={
  '青铜器':['bronze-tongbianzhong.jpg','bronze-tongchuheng.jpg','bronze-tongjing-ming.jpg','bronze-tongjing-tang.jpg','bronze-huyouniyu.jpg','bronze-huwentongge.jpg','bronze-tangyinlinhanxizaiyejintujuan.jpg','bronze-zenghouyizhong.jpg','bronze-zhanguoniaoxingtongzun.jpg'],
  '石质':['stone-dazushikediaoke.jpg','stone-dazushikefotou.jpg','stone-yadiaobaxian.jpg','stone-jiajingzhudiaorenwuchuan.jpg'],
  '金质':['gold-hanguiyiconghoujinyin.jpg','gold-pijiangjunjinyin.jpg','gold-jindaiju.jpg','gold-jinpijiangjunyinzhang.jpg'],
  '陶瓷':['ceramic-changkouheitaohu.jpg','ceramic-liulizhu.jpg','ceramic-liulichuanshi.jpg','ceramic-heitaoguan-daxi.jpg','ceramic-hongtaochimaodunyong.jpg','ceramic-tushanyao-heicipanguan.jpg','ceramic-xinshiqishiqihongtaoqi.jpg']
};
var _allRelicImgs=[];
Object.keys(_relicImgs).forEach(function(t){_relicImgs[t].forEach(function(f){_allRelicImgs.push('img/relics/'+f);});});
function relicImg(type,seed){
  var pool=_relicImgs[type]||_relicImgs['青铜器'];
  return 'img/relics/'+pool[Math.abs(seed)%pool.length];
}

// Deterministic CSS filter per relic — subtle variation per relic
function relicFilter(r){
  if(!r||!r.id)return '';
  var hash=0;var s=r.id;
  for(var i=0;i<s.length;i++){hash=((hash<<5)-hash+s.charCodeAt(i))|0;}
  var h=Math.abs(hash);
  var hue=(h%30)-15;
  var bright=0.96+((h>>3)%8)/100;
  var contrast=0.96+((h>>6)%8)/100;
  var sat=0.95+((h>>9)%10)/100;
  return 'hue-rotate('+hue+'deg) brightness('+bright+') contrast('+contrast+') saturate('+sat+')';
}
// Deterministic CSS transform per relic — subtle variety
function relicTransform(r){
  if(!r||!r.id)return '';
  var hash=0;var s=r.id;
  for(var i=0;i<s.length;i++){hash=((hash<<5)-hash+s.charCodeAt(i))|0;}
  var h=Math.abs(hash);
  var scale=0.97+((h>>2)%4)/100;
  var rotate=((h>>5)%3)-1;
  var flipX=(h>>8)%3===0?' scaleX(-1)':'';
  var originX=40+((h>>18)%20);
  var originY=40+((h>>21)%20);
  return 'transform: scale('+scale+') rotate('+rotate+'deg)'+flipX+'; transform-origin: '+originX+'% '+originY+'%;';
}
// Combined full style string for relic images (filter + transform) — use for large images
function relicStyle(r, extraFilter){
  if(!r)return '';
  var f=relicFilter(r)+(extraFilter?' '+extraFilter:'');
  var t=relicTransform(r);
  return 'filter: '+f+'; '+t;
}
// Filter-only style string — use for small thumbnails where transform would shift position
function relicStyleThumb(r, extraFilter){
  if(!r)return '';
  var f=relicFilter(r)+(extraFilter?' '+extraFilter:'');
  return 'filter: '+f+';';
}

// Stage-specific CSS filters — subtle differentiation between stages
function stageFilter(stage){
  if(stage==='excavated')return 'sepia(0.25) brightness(0.85) contrast(1.1) saturate(0.8)';
  if(stage==='cleaned')return 'brightness(1.05) contrast(1.03) sepia(0.04) saturate(0.95)';
  if(stage==='during')return 'brightness(0.95) contrast(1.05) saturate(0.9)';
  if(stage==='after')return 'brightness(1.03) contrast(1.05) saturate(1.08)';
  return '';
}

// Seeded pseudo-random for deterministic data
function srand(seed){
  var x=Math.sin(seed)*10000;
  return x-Math.floor(x);
}

// 6 new 3D model relics - all restored, Southwest China sites
var newRelics3D=[
  {id:'BYQ-2026-02001',type:'青铜器',lib:'巴渝青铜器专题',site:'重庆涪陵区',era:'汉代',disease:'锈蚀、局部变形、口沿残缺',name:'汉代青铜壶',imgBefore:'img/stages/han_pot_excavated.jpg',imgCleaned:'img/stages/han_pot_cleaned.jpg',imgDuring:'img/stages/han_pot_repairing.jpg',imgAfter:'img/stages/han_pot_repaired.jpg',glbRestored:'img/3d/han_pot_restored.glb',glbUnrestored:'img/3d/han_pot_broken.glb',uploader:'赵鹏',restorer:'崔丹',status:'已修复',progress:100},
  {id:'BYQ-2026-00001',type:'陶瓷',lib:'三峡出土文物专题',site:'重庆巫山县',era:'金代',disease:'釉面磨损、口沿小豁',name:'代号00001',imgBefore:'img/stages/r12_excavated.jpg',imgCleaned:'img/stages/r12_repairing.jpg',imgDuring:'img/stages/r12_cleaned.jpg',imgAfter:'img/stages/r12_repaired.jpg',glbRestored:'img/3d/relic3d_12_web.glb',glbUnrestored:'',uploader:'吴波文',restorer:'阎志强',status:'已修复',progress:100},
  {id:'BYQ-2026-00002',type:'陶瓷',lib:'三峡出土文物专题',site:'重庆奉节县',era:'元代',disease:'冲线、足部修复痕',name:'代号00002',imgBefore:'img/stages/r22_excavated.jpg',imgCleaned:'img/stages/r22_repairing.jpg',imgDuring:'img/stages/r22_cleaned.jpg',imgAfter:'img/stages/r22_repaired.jpg',glbRestored:'img/3d/relic3d_22_web.glb',glbUnrestored:'',uploader:'钱志强',restorer:'龙宇慧',status:'已修复',progress:100},
  {id:'BYQ-2026-00003',type:'青铜器',lib:'巴渝青铜器专题',site:'重庆巴南区',era:'战国',disease:'锈蚀、局部变形',name:'代号00003',imgBefore:'img/stages/r32_excavated.jpg',imgCleaned:'img/stages/r32_repairing.jpg',imgDuring:'img/stages/r32_cleaned.jpg',imgAfter:'img/stages/r32_repaired.jpg',glbRestored:'img/3d/relic3d_32_web.glb',glbUnrestored:'',uploader:'孔冰',restorer:'万嘉豪',status:'已修复',progress:100},
  {id:'BYQ-2026-00004',type:'青铜器',lib:'巴渝青铜器专题',site:'重庆合川区',era:'宋代',disease:'锈蚀、局部缺损',name:'代号00004',imgBefore:'img/stages/r42_excavated.jpg',imgCleaned:'img/stages/r42_repairing.jpg',imgDuring:'img/stages/r42_cleaned.jpg',imgAfter:'img/stages/r42_repaired.jpg',glbRestored:'img/3d/relic3d_42_web.glb',glbUnrestored:'',uploader:'毛辉婉',restorer:'龚薇诗',status:'已修复',progress:100},
  {id:'BYQ-2026-00005',type:'玉器',lib:'大足石刻专题',site:'重庆大足区',era:'汉代',disease:'沁色、边缘磨损',name:'代号00005',imgBefore:'img/stages/r52_excavated.jpg',imgCleaned:'img/stages/r52_repairing.jpg',imgDuring:'img/stages/r52_cleaned.jpg',imgAfter:'img/stages/r52_repaired.jpg',glbRestored:'img/3d/relic3d_52_web.glb',glbUnrestored:'',uploader:'石志强',restorer:'罗兰思',status:'已修复',progress:100},
  {id:'BYQ-2026-00006',type:'陶瓷',lib:'三峡出土文物专题',site:'重庆忠县',era:'商代',disease:'风化、缺损',name:'代号00006',imgBefore:'img/stages/r62_excavated.jpg',imgCleaned:'img/stages/r62_repairing.jpg',imgDuring:'img/stages/r62_cleaned.jpg',imgAfter:'img/stages/r62_repaired.jpg',glbRestored:'img/3d/relic3d_62_web.glb',glbUnrestored:'',uploader:'胡萍',restorer:'郭杰婉',status:'已修复',progress:100}
];

// stageImgSets removed — stage images now derived from main image via CSS filters (stageFilter)

function genRelics(){
  // Library-specific site pools — each library's relics come from its thematic region
  // 巴渝青铜器专题: 重庆巴渝文化区域出土
  var sitesBYQ=['重庆涪陵小田溪','重庆巴南区','重庆江北区','重庆合川区','重庆永川区','重庆长寿区','重庆綦江区','重庆南川区','重庆璧山区','重庆大渡口区','重庆渝北区','重庆江津区','重庆北碚区','重庆沙坪坝区','重庆九龙坡区','重庆渝中区'];
  // 三峡出土文物专题: 三峡库区（重庆段+湖北段）
  var sitesSXG=['重庆巫山县','重庆奉节县','重庆云阳县','重庆万州甘宁乡','重庆忠县','重庆开县','重庆丰都县','重庆武隆区','重庆石柱县','重庆涪陵区','湖北秭归县','湖北巴东县','湖北兴山县','湖北宜昌夷陵区'];
  // 大足石刻专题: 大足及周边石刻分布区
  var sitesDZS=['重庆大足区','重庆潼南区','重庆铜梁区','重庆永川区','重庆荣昌区','重庆双桥经开区','四川安岳县','四川资阳市','四川大足交界'];
  var libSites=[sitesBYQ,sitesSXG,sitesDZS];
  var types=['青铜器','石质','金质','陶瓷'];
  var diseases=['表面锈蚀、局部断裂','变形、缺失、锈蚀','断裂、风化','锈蚀严重','裂纹、磨损','碎裂、缺损','金箔脱落、铜锈','风化、面部缺损','焊接点开裂','边角缺损'];
  var eras=['商代','战国','西汉','东汉','南北朝','隋','唐','北宋','南宋','元','明','清','民国'];
  var uploaders=['龙强','赖文博','董莹','朱杰慧','秦浩然','赵鹏','萧强静','崔丹','段芳慧','董嘉怡','傅佳','梁敏诗','韩磊宇','雷欣','段若曦','余颖梦','袁兰子','乔兰','郝梓涵','吴波文','钱志强','孔冰','毛辉婉'];
  var restorers=['赵鹏','萧强静','崔丹','段芳慧','董嘉怡','傅佳','梁敏诗','韩磊宇','雷欣','段若曦'];
  var libNames=['巴渝青铜器专题','三峡出土文物专题','大足石刻专题'];
  var prefixes=['BYQ','SXG','DZS'];
  var libCounts=[820,820,821];
  var all=[];

  for(var libIdx=0;libIdx<libNames.length;libIdx++){
    var prefix=prefixes[libIdx];
    var libName=libNames[libIdx];
    var count=libCounts[libIdx];
    for(var j=11;j<=count+10;j++){
      var globalIdx=libIdx*10000+j;
      var seq=String(j).padStart(5,'0');
      var rv=srand(globalIdx);
      // Adjusted: 5% 待上传, 8% 已上传, 7% 待修复, 20% 修复中, 60% 已修复
      var status;
      if(rv<0.05)status='待上传';
      else if(rv<0.13)status='已上传';
      else if(rv<0.20)status='待修复';
      else if(rv<0.40)status='修复中';
      else status='已修复';

      var progress=0;
      if(status==='已修复')progress=100;
      else if(status==='修复中')progress=Math.floor(srand(globalIdx+1)*80)+10;
      else if(status==='待修复')progress=0;

      var restorer='';
      if(status==='修复中'||status==='已修复'){
        restorer=restorers[Math.floor(srand(globalIdx+2)*restorers.length)];
      }

      var typeIdx;
      if(libIdx===0){
        // 巴渝青铜器专题: mostly bronze + some gold
        typeIdx=srand(globalIdx+3)<0.75?0:2;
      }else if(libIdx===1){
        // 三峡出土文物专题: mostly ceramic + some bronze
        typeIdx=srand(globalIdx+3)<0.65?3:0;
      }else{
        // 大足石刻专题: mostly stone + some ceramic
        typeIdx=srand(globalIdx+3)<0.70?1:3;
      }
      var siteIdx=Math.floor(srand(globalIdx+4)*libSites[libIdx].length);
      var eraIdx=Math.floor(srand(globalIdx+5)*eras.length);
      var diseaseIdx=Math.floor(srand(globalIdx+6)*diseases.length);
      var uploaderIdx=Math.floor(srand(globalIdx+7)*uploaders.length);

      var imgBeforeUrl=relicImg(types[typeIdx],globalIdx);
      var imgCleanedUrl='';var imgDuringUrl='';var imgAfterUrl='';

      var day=String(Math.floor(srand(globalIdx+8)*28)+1).padStart(2,'0');
      var hr=String(Math.floor(srand(globalIdx+9)*12)+8).padStart(2,'0');
      var min=String(Math.floor(srand(globalIdx+10)*60)).padStart(2,'0');
      var uploadTime;
      var deadline='';
      if(status==='已修复'){
        var earlyMonth=String(Math.floor(srand(globalIdx+12)*4)+3).padStart(2,'0');
        var earlyDay=String(Math.floor(srand(globalIdx+13)*28)+1).padStart(2,'0');
        uploadTime='2026-0'+earlyMonth+'-'+earlyDay+' '+hr+':'+min;
        var dDay2=String(Math.floor(srand(globalIdx+11)*28)+1).padStart(2,'0');
        deadline='2026-07-'+dDay2;
      }else{
        uploadTime='2026-08-'+day+' '+hr+':'+min;
        if(status==='修复中'){
          var dDay3=String(Math.floor(srand(globalIdx+11)*28)+1).padStart(2,'0');
          deadline='2026-10-'+dDay3;
        }else if(status==='待修复'){
          deadline='2026-09-'+day;
        }
      }

      var lastUpdate='';
      if(status==='修复中'){
        var uDay=String(Math.floor(srand(globalIdx+14)*4)+20).padStart(2,'0');
        lastUpdate='2026-08-'+uDay+' '+hr+':00';
      }

      all.push({
        id:prefix+'-2026-'+seq,
        name:'代号'+seq,
        type:types[typeIdx],
        imgBefore:imgBeforeUrl,
        imgCleaned:imgCleanedUrl,
        imgDuring:imgDuringUrl,
        imgAfter:imgAfterUrl,
        library:libName,
        site:libSites[libIdx][siteIdx],
        era:eras[eraIdx],
        size:'待测量',
        weight:'待称重',
        uploadedBy:uploaders[uploaderIdx],
        uploadTime:uploadTime,
        status:status,
        restorer:restorer,
        progress:progress,
        deadline:deadline,
        lastUpdate:lastUpdate,
        disease:diseases[diseaseIdx]
      });
    }
  }
  // Sort by upload time descending (newest first)
  all.sort(function(a,b){return b.uploadTime.localeCompare(a.uploadTime);});
  // Assign type-specific unique images to the first 50 relics
  for(var i=0;i<50&&i<all.length;i++){
    all[i].imgBefore=relicImg(all[i].type,i*7+13);
  }
  // Add 3D model relics at the very beginning
  for(var k=newRelics3D.length-1;k>=0;k--){
    var nr=newRelics3D[k];
    nr.library=nr.lib;nr.size='待测量';nr.weight='待称重';
    nr.uploadedBy=nr.uploader;
    nr.uploadTime='2026-03-1'+(6-k)+' '+(9+k)+':'+(15+k*8<10?'0'+(15+k*8):15+k*8);
    nr.deadline='2026-07-30';
    nr.lastUpdate='2026-07-2'+k+' 16:30';
    nr.has3D=true;
    nr.glbRestoredName=nr.glbRestored?nr.glbRestored.split('/').pop():'';
    nr.glbUnrestoredName=nr.glbUnrestored?nr.glbUnrestored.split('/').pop():'';
    all.unshift(nr);
  }
  // Add 三羊尊 at position 25 (not on first page, page size=20)
  var syz={
    id:'BYQ-2026-02138',type:'青铜器',lib:'巴渝青铜器专题',site:'重庆巫山',era:'商朝',
    name:'三羊尊',status:'已修复',progress:100,
    disease:'肩部羊首饰件局部缺损；圈足铸造穿孔、边缘残缺；器身大面积蓝绿灰绿色锈蚀；埋藏裂隙多处；表面土垢硬结物覆盖云雷地纹；点腐蚀坑分布；存在粉状锈风险',
    imgBefore:'img/stages/sanyangzun_excavated.jpg',
    imgCleaned:'img/stages/sanyangzun_cleaned.jpg',
    imgDuring:'img/stages/sanyangzun_repairing.jpg',
    imgAfter:'img/stages/sanyangzun_repaired.jpg',
    glbRestored:'img/3d/sanyangzun_restored.glb',
    glbUnrestored:'img/3d/sanyangzun_broken.glb',
    uploader:'赵鹏',restorer:'崔丹',
    library:'巴渝青铜器专题',size:'通高43.8cm 口径42cm 底径23.5cm 腹围106cm',weight:'待称重',
    uploadedBy:'赵鹏',uploadTime:'2026-04-12 10:30',
    deadline:'2026-08-15',lastUpdate:'2026-07-28 14:20',
    has3D:true,
    glbRestoredName:'sanyangzun_restored.glb',
    glbUnrestoredName:'sanyangzun_broken.glb'
  };
  if(all.length>25){all.splice(25,0,syz);}else{all.push(syz);}
  return all;
}

function genUsers(){
  var excelData=[
    {workId:'CQ-001',name:'龙强',nickname:'数据管家小强',role:'系统管理员',dept:'信息中心',phone:'13800010158',scope:'全部文物'},
    {workId:'CQ-002',name:'赖文博',nickname:'系统管家赖',role:'系统管理员',dept:'信息中心',phone:'13800010159',scope:'全部文物'},
    {workId:'CQ-003',name:'董莹',nickname:'委员会老董',role:'修复委员会主任',dept:'修复委员会',phone:'13800010160',scope:'全部文物'},
    {workId:'CQ-004',name:'朱杰慧',nickname:'委员朱',role:'修复委员会主任',dept:'修复委员会',phone:'13800010161',scope:'全部文物'},
    {workId:'CQ-005',name:'秦浩然',nickname:'审定专家秦',role:'修复委员会主任',dept:'修复委员会',phone:'13800010162',scope:'全部文物'},
    {workId:'CQ-006',name:'赵鹏',nickname:'青铜专家赵',role:'修复师',dept:'修复部-青铜组',phone:'13800010163',scope:'指定专题库'},
    {workId:'CQ-007',name:'萧强静',nickname:'匠心传人萧',role:'修复师',dept:'修复部-青铜组',phone:'13800010164',scope:'指定专题库'},
    {workId:'CQ-008',name:'崔丹',nickname:'青铜专家崔',role:'修复师',dept:'修复部-青铜组',phone:'13800010165',scope:'指定专题库'},
    {workId:'CQ-009',name:'段芳慧',nickname:'青铜达人小慧',role:'修复师',dept:'修复部-青铜组',phone:'13800010166',scope:'指定专题库'},
    {workId:'CQ-010',name:'董嘉怡',nickname:'青铜专家董',role:'修复师',dept:'修复部-青铜组',phone:'13800010167',scope:'指定专题库'},
    {workId:'CQ-011',name:'傅佳',nickname:'匠心传人傅',role:'修复师',dept:'修复部-陶瓷组',phone:'13800010168',scope:'指定专题库'},
    {workId:'CQ-012',name:'梁敏诗',nickname:'青铜专家梁',role:'修复师',dept:'修复部-陶瓷组',phone:'13800010169',scope:'指定专题库'},
    {workId:'CQ-013',name:'韩磊宇',nickname:'匠心传人韩',role:'修复师',dept:'修复部-石质组',phone:'13800010170',scope:'指定专题库'},
    {workId:'CQ-014',name:'雷欣',nickname:'石质专家雷',role:'修复师',dept:'修复部-石质组',phone:'13800010171',scope:'指定专题库'},
    {workId:'CQ-015',name:'段若曦',nickname:'巧手段',role:'修复师',dept:'修复部-陶瓷组',phone:'13800010172',scope:'指定专题库'},
    {workId:'CQ-016',name:'余颖梦',nickname:'保管达人余',role:'保管员',dept:'保管部-库房A',phone:'13800010173',scope:'指定库房'},
    {workId:'CQ-017',name:'袁兰子',nickname:'文物守护者袁',role:'保管员',dept:'保管部-库房A',phone:'13800010174',scope:'指定库房'},
    {workId:'CQ-018',name:'乔兰',nickname:'保管达人乔',role:'保管员',dept:'保管部-库房B',phone:'13800010175',scope:'指定库房'},
    {workId:'CQ-019',name:'郝梓涵',nickname:'文物守护者郝',role:'保管员',dept:'保管部-库房B',phone:'13800010176',scope:'指定库房'},
    {workId:'CQ-020',name:'吴波文',nickname:'考据专家吴',role:'研究人员',dept:'研究部',phone:'13800010177',scope:'仅查看已修复'},
    {workId:'CQ-021',name:'钱志强',nickname:'研究达人钱',role:'研究人员',dept:'研究部',phone:'13800010178',scope:'仅查看已修复'},
    {workId:'CQ-022',name:'孔冰',nickname:'研究达人孔',role:'研究人员',dept:'研究部',phone:'13800010179',scope:'仅查看已修复'},
    {workId:'CQ-023',name:'毛辉婉',nickname:'考据专家毛',role:'研究人员',dept:'研究部',phone:'13800010180',scope:'仅查看已修复'}
  ];
  var users=[];
  for(var i=0;i<excelData.length;i++){
    var d=excelData[i];
    var idx=i+1;
    var isEarly=idx<=5;
    var lastLogin=isEarly?'2026-08-2'+(idx%3)+' '+String((idx%12)+8).padStart(2,'0')+':00':'2026-08-2'+(idx%3)+' '+String((idx%12)+8).padStart(2,'0')+':00';
    users.push({id:'U'+String(idx).padStart(3,'0'),name:d.name,workId:d.workId,nickname:d.nickname,roleId:d.role,roleName:d.role,department:d.dept,phone:d.phone,status:'正常',lastLogin:lastLogin,scope:d.scope,perms:{view:true,edit:d.role.indexOf('修复')>=0||d.role==='系统管理员',delete:d.role==='系统管理员',audit:d.role.indexOf('管理')>=0||d.role.indexOf('主任')>=0,assign:d.role.indexOf('管理')>=0||d.role.indexOf('主任')>=0}});
  }
  return users;
}

createApp({setup(){
  var loggedIn=ref(false);var authMode=ref('login');
  var loginForm=reactive({username:'',password:''});var loginErr=ref('');
  var regForm=reactive({name:'',workId:'',phone:'',email:'',department:'',roleId:''});var regErr=ref('');
  var regRoles=[{id:'restorer',name:'修复师'},{id:'curator',name:'保管员'},{id:'researcher',name:'研究人员'}];
  onMounted(function(){
    try{resolveAllIdbImgs();}catch(e){}
    // Sync data from server on load, then reload Vue reactive data
    syncAllFromServer(function(){
      try{
      // Reload relics from (now-updated) localStorage
      var _newUserRelics=loadUserRelics();
      var _newOverrides=loadRelicOverrides();
      var _newGenRelics=genRelics();
      var _newAll=_newUserRelics.concat(_newGenRelics);
      _newAll.forEach(function(r){
        var ov=_newOverrides[r.id];
        if(ov){for(var k in ov){r[k]=ov[k];}}
      });
      relics.value.splice(0,relics.value.length);
      _newAll.forEach(function(r){relics.value.push(r);});
      // Reload allUsers
      var _savedUsers=loadAllUsers();
      if(_savedUsers){allUsers.value.splice(0,allUsers.value.length);_savedUsers.forEach(function(u){allUsers.value.push(u);});}
      // Reload libs
      var _savedLibs2=loadLibs();
      if(_savedLibs2){libs.value.splice(0,libs.value.length);_savedLibs2.forEach(function(l){libs.value.push(l);});}
      resolveAllIdbImgs();
      }catch(e){console.warn('Init callback error:',e);}
    });
    // Periodic sync every 15s — pull updates from other devices
    setInterval(function(){
      if(!loggedIn.value)return;
      syncAllFromServer(function(){
        var _newOverrides=loadRelicOverrides();
        relics.value.forEach(function(r){
          var ov=_newOverrides[r.id];
          if(ov){for(var k in ov){r[k]=ov[k];}}
        });
        var _savedUsers=loadAllUsers();
        if(_savedUsers){allUsers.value.splice(0,allUsers.value.length);_savedUsers.forEach(function(u){allUsers.value.push(u);});}
      });
    },15000);
    // Also sync when window regains focus
    window.addEventListener('focus',function(){
      syncAllFromServer(function(){
        var _newOverrides2=loadRelicOverrides();
        relics.value.forEach(function(r){
          var ov=_newOverrides2[r.id];
          if(ov){for(var k in ov){r[k]=ov[k];}}
        });
        var _savedUsers2=loadAllUsers();
        if(_savedUsers2){allUsers.value.splice(0,allUsers.value.length);_savedUsers2.forEach(function(u){allUsers.value.push(u);});}
      });
    });
    // Auto-login from saved session
    var saved=loadLoginUser();
    if(saved&&saved.name){
      currentUser.name=saved.name;
      currentUser.nickname=saved.nickname||saved.name;
      currentUser.role=saved.roleId||'';
      currentUser.roleName=saved.roleName||'';
      currentUser.workId=saved.workId||'';
      currentUser.scope=saved.scope||'';
      currentUser.perms=saved.perms||rolePerms['研究人员'];
      loggedIn.value=true;
      nextTick(function(){setTimeout(function(){initCharts();},600);});
    }
  });
  var showNicknameModal=ref(false);var nickInput=ref('');var roleApply=ref('');var permApply=ref('');
  function openNicknameModal(){nickInput.value=currentUser.nickname||currentUser.name||'';roleApply.value='';permApply.value='';showNicknameModal.value=true;}
  function saveNickname(){
    if(nickInput.value&&nickInput.value.trim()){
      currentUser.nickname=nickInput.value.trim();
      saveLoginUser(currentUser);
      // Also update allUsers and persist
      var u=allUsers.value.find(function(x){return x.name===currentUser.name;});
      if(u){u.nickname=currentUser.nickname;}
      saveAllUsers(allUsers.value);
    }
    if(roleApply.value&&roleApply.value!==currentUser.roleName){
      pendingUsers.value.push({id:'PR'+Date.now(),name:currentUser.name,workId:'当前用户',phone:'-',roleId:'',roleName:roleApply.value+'（身份变更申请）',regTime:new Date().toLocaleString('zh-CN'),status:'待审核',scope:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false},applyReason:permApply.value||'申请身份变更为'+roleApply.value});
      alert('身份变更申请已提交，请等待管理员审核');
    }
    if(permApply.value.trim()&&(!roleApply.value||roleApply.value===currentUser.roleName)){
      alert('权限申请已提交，请等待管理员审核');
    }
    showNicknameModal.value=false;
  }
  var roles=[{id:'admin',name:'系统管理员',permissions:'系统配置、用户管理、权限审核、全量数据',dataScope:'全量数据',userCount:2},{id:'director',name:'修复委员会主任',permissions:'修复审批、方案终审、验收确认',dataScope:'全量修复项目',userCount:3},{id:'restorer',name:'修复师',permissions:'修复方案编制、修复日志记录、影像上传',dataScope:'本人参与项目',userCount:10},{id:'curator',name:'保管员',permissions:'出入库操作、库房盘点、环境监测',dataScope:'所属库房',userCount:4},{id:'researcher',name:'研究人员',permissions:'文物查询、修复档案检索（只读）',dataScope:'已归档数据',userCount:4}];
  var currentUser=reactive({name:'',nickname:'',role:'',roleName:'',workId:'',scope:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});

  // Role-based permission definitions
  var rolePerms={
    '系统管理员':{view:true,edit:true,delete:true,audit:true,assign:true,manageUsers:true,viewStats:true,viewAI:true,dataScope:'all'},
    '修复委员会主任':{view:true,edit:true,delete:false,audit:true,assign:true,manageUsers:false,viewStats:true,viewAI:true,dataScope:'all'},
    '修复师':{view:true,edit:true,delete:false,audit:false,assign:false,manageUsers:false,viewStats:false,viewAI:true,dataScope:'assigned'},
    '保管员':{view:true,edit:false,delete:false,audit:false,assign:false,manageUsers:false,viewStats:false,viewAI:false,dataScope:'assigned'},
    '研究人员':{view:true,edit:false,delete:false,audit:false,assign:false,manageUsers:false,viewStats:false,viewAI:false,dataScope:'readonly'}
  };

  var canManageUsers=computed(function(){return currentUser.perms&&currentUser.perms.manageUsers;});
  var canViewStats=computed(function(){return currentUser.perms&&currentUser.perms.viewStats;});
  var canViewAI=computed(function(){return currentUser.perms&&currentUser.perms.viewAI;});
  var canAssign=computed(function(){return currentUser.perms&&currentUser.perms.assign;});
  var canEdit=computed(function(){return currentUser.perms&&currentUser.perms.edit;});
  var canDelete=computed(function(){return currentUser.perms&&currentUser.perms.delete;});
  var canAudit=computed(function(){return currentUser.perms&&currentUser.perms.audit;});
  // Filter relics based on user role data scope — single source of truth for visibility
  var scopedRelics=computed(function(){
    if(!currentUser.perms)return relics.value;
    var scope=currentUser.perms.dataScope;
    if(scope==='all')return relics.value;
    if(scope==='readonly'){
      // Research users only see completed/archived relics
      return relics.value.filter(function(r){return r.status==='已修复';});
    }
    if(scope==='assigned'){
      // Restorers: only their assigned relics; curators/uploaders: only their uploaded relics
      var name=currentUser.name;
      return relics.value.filter(function(r){
        return r.restorer===name||r.uploadedBy===name;
      });
    }
    return relics.value;
  });

  function doLogin(){
    loginErr.value='';
    if(!loginForm.username||!loginForm.password){loginErr.value='请输入账号和密码';return;}
    var u=allUsers.value.find(function(x){return x.workId===loginForm.username||x.phone===loginForm.username;});
    if(!u){loginErr.value='账号不存在，请检查工号或手机号';return;}
    if(u.status!=='正常'){loginErr.value='账号已被禁用，请联系管理员';return;}
    var excelPwds={'CQ-001':'Lq2094@rest','CQ-002':'Lb2106#work','CQ-003':'Dy2091!rest','CQ-004':'Zh2040@dir','CQ-005':'Qh2048rest@','CQ-006':'Zp2031!rest','CQ-007':'Xq2037#rest','CQ-008':'Cd2098@rest','CQ-009':'Df2055rest@','CQ-010':'Dj2094rest!','CQ-011':'Fj2041@2026','CQ-012':'Lm2033!rest','CQ-013':'Hl2100@2026','CQ-014':'Lx2039@2026','CQ-015':'Dr2094#rest','CQ-016':'Yy2070rest!','CQ-017':'Yl2073#rest','CQ-018':'Ql2047@work','CQ-019':'Hz2057rest!','CQ-020':'Wb2071rest!','CQ-021':'Qz2040@work','CQ-022':'Kb2036#rest','CQ-023':'Mh2080!rest'};
    var expectedPwd=excelPwds[u.workId];
    if(expectedPwd&&loginForm.password!==expectedPwd){loginErr.value='密码错误';return;}
    currentUser.name=u.name;currentUser.nickname=u.nickname||u.name;currentUser.role=u.roleId;currentUser.roleName=u.roleName;currentUser.workId=u.workId;currentUser.scope=u.scope||'';
    currentUser.perms=rolePerms[u.roleName]||rolePerms['研究人员'];
    u.lastLogin=new Date().toLocaleString('zh-CN');
    saveLoginUser(currentUser);
    loggedIn.value=true;
    // Pull latest data from server after login, then refresh UI
    syncAllFromServer(function(){
      try{
        var _ov=loadRelicOverrides();
        var _ur=loadUserRelics();
        var _gr=genRelics();
        var _all=_ur.concat(_gr);
        _all.forEach(function(r){var o=_ov[r.id];if(o){for(var k in o){r[k]=o[k];}}});
        relics.value.splice(0,relics.value.length);
        _all.forEach(function(r){relics.value.push(r);});
        var _su=loadAllUsers();
        if(_su){allUsers.value.splice(0,allUsers.value.length);_su.forEach(function(x){allUsers.value.push(x);});}
        var _sl=loadLibs();
        if(_sl){libs.value.splice(0,libs.value.length);_sl.forEach(function(x){libs.value.push(x);});}
        resolveAllIdbImgs();
      }catch(e){}
    });
    nextTick(function(){setTimeout(function(){initCharts();},600);});
  }
  function doRegister(){
    regErr.value='';
    if(!regForm.name){regErr.value='请输入姓名';return;}
    if(!regForm.workId){regErr.value='请输入工号';return;}
    if(!regForm.phone){regErr.value='请输入手机号';return;}
    if(!regForm.roleId){regErr.value='请选择身份';return;}
    var role=regRoles.find(function(r){return r.id===regForm.roleId;});
    var newU={id:'U'+Date.now(),name:regForm.name,workId:regForm.workId,phone:regForm.phone,email:regForm.email,department:regForm.department,roleId:regForm.roleId,roleName:role?role.name:'',regTime:new Date().toLocaleString('zh-CN'),status:'待审核',scope:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false}};
    pendingUsers.value.push(newU);
    var regUsers=loadRegUsers();regUsers.push(newU);saveRegUsers(regUsers);
    alert('注册申请已提交，请等待管理员审核通过后即可登录。');
    authMode.value='login';regForm.name='';regForm.workId='';regForm.phone='';regForm.email='';regForm.department='';regForm.roleId='';
  }
  function logout(){
    // Save all relic changes before logout to ensure persistence
    try{
      relics.value.forEach(function(r){
        if(r.userUploaded||r._modified){saveRelicChange(r);}
      });
      saveAllUsers(allUsers.value);
    }catch(e){console.warn('Save on logout failed:',e);}
    loggedIn.value=false;loginForm.username='';loginForm.password='';loginErr.value='';
    try{localStorage.removeItem(LOGIN_KEY);}catch(e){}
  }

  var page=ref('dashboard');
  var pageTitle=computed(function(){return{dashboard:'总览面板',thematic:'专题库管理',relics:'文物列表',detail:'文物详情',assignment:'修复任务分配',monitor:'修复进度监控',traceability:'责任链追溯',statistics:'统计分析',accounts:'用户与权限',aiRepair:'AI智能修复分析',cloud:'云端同步'}[page.value]||'';});
  function nav(p){page.value=p;}

  var types=['青铜器','石质','金质','陶瓷'];
  var libStatuses=['采集中','采集中','修复中'];
  var _defaultLibs=[
    {id:'TL01',name:'巴渝青铜器专题',prefix:'BYQ',desc:'重庆地区出土巴蜀青铜器、金质文物修复管理',count:820,status:libStatuses[0]},
    {id:'TL02',name:'三峡出土文物专题',prefix:'SXG',desc:'三峡库区出土陶瓷器及综合性文物数字化采集与修复',count:820,status:libStatuses[1]},
    {id:'TL03',name:'大足石刻专题',prefix:'DZS',desc:'大足石刻及石质文物保护与修复项目',count:821,status:libStatuses[2]}
  ];
  var _savedLibs=loadLibs();
  var libs=ref(_savedLibs?_savedLibs.concat(_defaultLibs.filter(function(d){return !_savedLibs.find(function(s){return s.id===d.id;});})):_defaultLibs);
  var _generatedRelics=genRelics();
  var _userRelics=loadUserRelics();
  var relics=ref(_userRelics.concat(_generatedRelics));

  // Apply persisted overrides to generated relics (status, progress, restorer, images, etc.)
  var _overrides=loadRelicOverrides();
  relics.value.forEach(function(r){
    var ov=_overrides[r.id];
    if(ov){
      for(var k in ov){
        r[k]=ov[k];
      }
    }
  });
  // Stage images are now derived from the main image via CSS filters (stageFilter)
  // Only user-uploaded stage images (stored as overrides) will override this
  // No more stageImgSets assignment — eliminates "张冠李戴" mismatching
  var resolvedImgs=reactive({});
  function resolveAllIdbImgs(){
    relics.value.forEach(function(r){
      if(r.imgBefore&&r.imgBefore.indexOf('idb://')===0){
        resolveIdbUrl(r.imgBefore).then(function(url){if(url)resolvedImgs[r.id]=url;});
      }
      if(r.imgCleaned&&r.imgCleaned.indexOf('idb://')===0){
        resolveIdbUrl(r.imgCleaned).then(function(url){if(url)resolvedImgs[r.id+'_cleaned']=url;});
      }
      if(r.imgDuring&&r.imgDuring.indexOf('idb://')===0){
        resolveIdbUrl(r.imgDuring).then(function(url){if(url)resolvedImgs[r.id+'_during']=url;});
      }
      if(r.imgAfter&&r.imgAfter.indexOf('idb://')===0){
        resolveIdbUrl(r.imgAfter).then(function(url){if(url)resolvedImgs[r.id+'_after']=url;});
      }
    });
  }
  var _generatedUsers=genUsers();
  var _savedUsers=loadAllUsers();
  if(_savedUsers){
    // Merge: keep saved users, add any generated users not in saved
    var savedIds={};_savedUsers.forEach(function(u){savedIds[u.workId]=true;});
    _generatedUsers.forEach(function(u){if(!savedIds[u.workId])_savedUsers.push(u);});
    allUsers=ref(_savedUsers);
  }else{
    allUsers=ref(_generatedUsers);
  }

  function latestImg(r){
    if(r.status==='已修复'&&r.imgAfter){
      if(r.imgAfter.indexOf('idb://')===0)return resolvedImgs[r.id+'_after']||r.imgAfter;
      return r.imgAfter;
    }
    if(r.status==='修复中'&&r.imgDuring){
      if(r.imgDuring.indexOf('idb://')===0)return resolvedImgs[r.id+'_during']||r.imgDuring;
      return r.imgDuring;
    }
    if((r.status==='待修复'||r.status==='修复中')&&r.imgCleaned){
      if(r.imgCleaned.indexOf('idb://')===0)return resolvedImgs[r.id+'_cleaned']||r.imgCleaned;
      return r.imgCleaned;
    }
    return resolvedImgs[r.id]||r.imgBefore;
  }
  var placeholderSvg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" rx="6" fill="#e5e7eb"/><text x="18" y="22" font-size="10" fill="#9ca3af" text-anchor="middle">无图</text></svg>');
  function imgFallback(e){e.target.src=placeholderSvg;}

  var fStatus=ref('全部');var fType=ref('');var fLib=ref('');var search=ref('');
  var assignSearch=ref('');
  var pendingAssignRelics=computed(function(){
    return scopedRelics.value.filter(function(r){return r.status==='已上传';});
  });
  var filteredAssignRelics=computed(function(){
    var q=assignSearch.value.trim().toLowerCase();
    if(!q)return pendingAssignRelics.value;
    return pendingAssignRelics.value.filter(function(r){
      return (r.id&&r.id.toLowerCase().indexOf(q)>=0)||
             (r.name&&r.name.toLowerCase().indexOf(q)>=0)||
             (r.type&&r.type.toLowerCase().indexOf(q)>=0)||
             (r.disease&&r.disease.toLowerCase().indexOf(q)>=0)||
             (r.site&&r.site.toLowerCase().indexOf(q)>=0);
    });
  });
  var filteredRelics=computed(function(){return scopedRelics.value.filter(function(r){
    if(fStatus.value!=='全部'&&r.status!==fStatus.value)return false;
    if(fType.value&&r.type!==fType.value)return false;
    if(fLib.value&&r.library!==fLib.value)return false;
    if(search.value){var s=search.value.toLowerCase();if(r.id.toLowerCase().indexOf(s)<0&&r.site.indexOf(search.value)<0)return false;}
    return true;
  });});
  var pageSize=20;var curPage=ref(1);
  var totalPages=computed(function(){return Math.ceil(filteredRelics.value.length/pageSize);});
  var pagedRelics=computed(function(){var start=(curPage.value-1)*pageSize;return filteredRelics.value.slice(start,start+pageSize);});
  var visiblePages=computed(function(){
    var pages=[];var c=curPage.value;var t=totalPages.value;
    if(t<=10){for(var i=1;i<=t;i++)pages.push(i);return pages;}
    pages.push(1);
    if(c>4)pages.push('...');
    for(var i=Math.max(2,c-2);i<=Math.min(t-1,c+2);i++)pages.push(i);
    if(c<t-3)pages.push('...');
    if(t>1)pages.push(t);
    return pages;
  });
  watch([fStatus,fType,fLib,search],function(){curPage.value=1;});

  function sc(s){return scopedRelics.value.filter(function(r){return r.status===s;}).length;}
  function sb(s){return{'待上传':'b-s1','已上传':'b-s2','待修复':'b-s3','修复中':'b-s4','已修复':'b-s5'}[s]||'';}
  var repairingCount=computed(function(){return scopedRelics.value.filter(function(r){return r.status==='修复中';}).length;});
  var pendingCount=computed(function(){return scopedRelics.value.filter(function(r){return r.status==='已上传';}).length;});

  var showNoti=ref(false);
  var notifications=ref([
    {id:1,text:'BYQ-2026-00832 修复进度更新为65%',time:'2小时前'},
    {id:2,text:'SXG-2026-00471 等待分配修复师',time:'1天前'},
    {id:3,text:'DZS-2026-01023 修复完成，已归档',time:'3天前'}
  ]);
  var pendingItems=computed(function(){
    var items=[];
    var ds=currentUser.perms&&currentUser.perms.dataScope;
    var role=currentUser.roleName;
    if(role==='系统管理员'||role==='修复委员会主任'){
      var up=relics.value.filter(function(r){return r.status==='已上传';});
      if(up.length>0)items.push({id:'p1',level:'warn',icon:'!',text:up.length+' 件文物等待分配修复师',btnType:'outline',btnText:'去分配',action:function(){nav('assignment');}});
      relics.value.filter(function(r){return r.status==='修复中'&&r.progress<30;}).slice(0,3).forEach(function(r){items.push({id:'p'+r.id,level:'no',icon:'!',text:r.id+' 修复进度偏低 ('+r.progress+'%)',btnType:'outline',btnText:'查看',action:function(){viewRelic(r);}});});
      if(pendingUsers.value.length>0)items.push({id:'pu',level:'info',icon:'i',text:pendingUsers.value.length+' 个用户待审核',btnType:'outline',btnText:'去审核',action:function(){nav('accounts');}});
    }else if(role==='修复师'){
      var myRepairing=relics.value.filter(function(r){return r.status==='修复中'&&r.restorer===currentUser.name;});
      var myPending2=relics.value.filter(function(r){return r.status==='待修复'&&r.restorer===currentUser.name;});
      if(myPending2.length>0||myRepairing.length>0){
        items.push({id:'p_summary',level:'warn',icon:'!',text:'您共有 '+(myPending2.length+myRepairing.length)+' 件文物待处理（待修复 '+myPending2.length+' · 修复中 '+myRepairing.length+'）',btnType:'outline',btnText:'去监控',action:function(){nav('monitor');}});
      }
      myRepairing.slice(0,5).forEach(function(r){items.push({id:'p'+r.id,level:'no',icon:'!',text:r.id+' 修复中 (进度 '+r.progress+'% · '+stageLabel(r.progress)+')',btnType:'outline',btnText:'查看',action:function(){viewRelic(r);}});});
      myPending2.slice(0,5).forEach(function(r){items.push({id:'p'+r.id,level:'warn',icon:'!',text:r.id+' 待您开始修复',btnType:'outline',btnText:'查看',action:function(){viewRelic(r);}});});
    }else if(role==='保管员'){
      var myUploads=relics.value.filter(function(r){return r.uploadedBy===currentUser.name&&r.status==='已上传';});
      if(myUploads.length>0)items.push({id:'p3',level:'warn',icon:'!',text:myUploads.length+' 件您上传的文物待分配修复师',btnType:'outline',btnText:'查看',action:function(){nav('relics');}});
    }else if(role==='研究人员'){
      var recently=relics.value.filter(function(r){return r.status==='已修复';}).slice(-3);
      recently.forEach(function(r){items.push({id:'p'+r.id,level:'info',icon:'i',text:r.id+' 已修复完成，可查看档案',btnType:'outline',btnText:'查看',action:function(){viewRelic(r);}});});
    }
    return items;
  });

  // Per-user pending total
  var myPendingTotal=computed(function(){
    var role=currentUser.roleName;
    if(!role)return 0;
    if(role==='修复师'){
      return relics.value.filter(function(r){
        return r.restorer===currentUser.name&&(r.status==='待修复'||r.status==='修复中');
      }).length;
    }else if(role==='系统管理员'||role==='修复委员会主任'){
      return relics.value.filter(function(r){
        return r.status==='已上传'||r.status==='待修复'||r.status==='修复中';
      }).length;
    }else if(role==='保管员'){
      return relics.value.filter(function(r){
        return r.uploadedBy===currentUser.name&&(r.status==='已上传'||r.status==='待修复');
      }).length;
    }else if(role==='研究人员'){
      return relics.value.filter(function(r){return r.status==='已修复';}).length;
    }
    return 0;
  });
  var myRepairingCount=computed(function(){
    return relics.value.filter(function(r){return r.restorer===currentUser.name&&r.status==='修复中';}).length;
  });
  var myPendingRepairCount=computed(function(){
    return relics.value.filter(function(r){return r.restorer===currentUser.name&&r.status==='待修复';}).length;
  });
  var myDoneCount=computed(function(){
    return relics.value.filter(function(r){return r.restorer===currentUser.name&&r.status==='已修复';}).length;
  });

  var sel=ref(null);var dTab=ref('timeline');
  var selTimeline=computed(function(){if(!sel.value)return[];return[
    {id:1,time:sel.value.uploadTime,cls:'done',title:'文物上传',desc:'移动端扫描上传完成',person:sel.value.uploadedBy},
    {id:2,time:sel.value.uploadTime,cls:'done',title:'数据审核',desc:'Web端审核通过',person:'龙强'},
  ].concat(sel.value.restorer?[{id:3,time:'',cls:'',title:'修复分配',desc:'分配给 '+sel.value.restorer,person:'董莹'}]:[])
    .concat(sel.value.status==='修复中'||sel.value.status==='已修复'?[{id:4,time:sel.value.lastUpdate,cls:'warn',title:'修复进行中',desc:'当前进度 '+sel.value.progress+'%',person:sel.value.restorer}]:[])
    .concat(sel.value.status==='已修复'?[{id:5,time:'',cls:'done',title:'修复完成',desc:'验收通过，已归档',person:'朱杰慧'}]:[]);});
  var selChain=computed(function(){if(!sel.value)return[];return[
    {step:'1 建立专题库',time:sel.value.uploadTime.split(' ')[0],desc:'创建'+sel.value.library,person:'赖文博',role:'项目负责人',terminal:'Web端'},
    {step:'2 扫描上传',time:sel.value.uploadTime,desc:'移动端扫描上传',person:sel.value.uploadedBy,role:'现场工作人员',terminal:'移动端'},
    {step:'3 数据审核',time:sel.value.uploadTime,desc:'审核通过',person:'龙强',role:'Web端管理员',terminal:'Web端'},
  ].concat(sel.value.restorer?[{step:'4 修复分配',time:'',desc:'分配给修复师',person:'董莹',role:'修复部门负责人',terminal:'Web端'}]:[])
    .concat(sel.value.status==='修复中'||sel.value.status==='已修复'?[{step:'5 修复执行',time:sel.value.lastUpdate,desc:'进度'+sel.value.progress+'%',person:sel.value.restorer,role:'修复师',terminal:'移动端'}]:[])
    .concat(sel.value.status==='已修复'?[{step:'6 验收确认',time:'',desc:'验收通过',person:'朱杰慧',role:'修复委员会',terminal:'Web端'},{step:'7 归档跟踪',time:'',desc:'修复档案归档',person:'秦浩然',role:'档案管理员',terminal:'Web端'}]:[]);});
  var repairLogs=ref([{id:1,date:'2026-08-21',content:'表面清洗，去除浮锈',materials:'EDTA溶液、脱离子水',hours:4,restorer:'赵鹏'},{id:2,date:'2026-08-22',content:'断裂部位粘接',materials:'Paraloid B-72',hours:6,restorer:'萧强静'},{id:3,date:'2026-08-23',content:'补全处理，做色',materials:'矿物颜料、丙烯酸树脂',hours:5,restorer:'崔丹'}]);
  function viewRelic(r){sel.value=r;dTab.value='timeline';nav('detail');}
  function delRelic(r){
    if(!confirm('确认删除文物 '+r.id+'？此操作不可撤销。'))return;
    var idx=relics.value.findIndex(function(x){return x.id===r.id;});
    if(idx>=0){
      relics.value.splice(idx,1);
      if(r.userUploaded){var saved=loadUserRelics();var sIdx=saved.findIndex(function(x){return x.id===r.id;});if(sIdx>=0){saved.splice(sIdx,1);saveUserRelics(saved);}}
      deleteRelicOverride(r.id);
      alert('文物 '+r.id+' 已删除');
    }
  }
  var showEditRestorerModal=ref(false);var editRestorerTarget=ref(null);var editRestorerForm=reactive({restorer:'',status:'',deadline:''});
  function openEditRestorer(r){editRestorerTarget.value=r;editRestorerForm.restorer=r.restorer||'';editRestorerForm.status=r.status||'';editRestorerForm.deadline=r.deadline||'';showEditRestorerModal.value=true;}
  function saveEditRestorer(){
    var r=editRestorerTarget.value;if(!r)return;
    if(editRestorerForm.restorer)r.restorer=editRestorerForm.restorer;
    if(editRestorerForm.status)r.status=editRestorerForm.status;
    if(editRestorerForm.deadline)r.deadline=editRestorerForm.deadline;
    if(r.status==='已修复')r.progress=100;
    else if(r.status==='修复中')r.progress=Math.max(r.progress||0,10);
    else if(r.status==='待修复')r.progress=0;
    r.lastUpdate=new Date().toLocaleString('zh-CN');
    saveRelicChange(r);
    showEditRestorerModal.value=false;
  }
  function approveUser(){var u=auditTarget.value;u.scope=auditForm.scope;u.perms=JSON.parse(JSON.stringify(auditForm.perms));u.status='正常';u.roleId=u.roleId||'restorer';var role=roles.find(function(r){return r.id===u.roleId;});if(role)u.roleName=role.name;u.lastLogin='未登录';u.nickname=u.name;allUsers.value.push(u);saveAllUsers(allUsers.value);var idx=pendingUsers.value.findIndex(function(x){return x.id===u.id;});if(idx>-1)pendingUsers.value.splice(idx,1);showAuditModal.value=false;var regUsers=loadRegUsers();regUsers=regUsers.filter(function(x){return x.id!==u.id;});saveRegUsers(regUsers);alert('用户「'+u.name+'」审核通过');}

  var showLibModal=ref(false);var newLib=reactive({name:'',prefix:'',desc:''});
  function createLib(){if(!newLib.name||!newLib.prefix){alert('请填写名称和前缀');return;}
    libs.value.push({id:'TL'+String(libs.value.length+1).padStart(2,'0'),name:newLib.name,prefix:newLib.prefix,desc:newLib.desc,count:0,status:'采集中'});
    saveLibs(libs.value);
    showLibModal.value=false;newLib.name='';newLib.prefix='';newLib.desc='';
  }
  function filterByLib(lib){fLib.value=lib.name;nav('relics');}

  var showUploadModal=ref(false);var upForm=reactive({library:'',name:'',type:'青铜器',era:'',site:'',size:'',weight:'',disease:'',glbUrl:'',glbName:'',has3D:false,imgUrl:'',imgName:'',glbBlob:null,imgBlob:null});
  var _pendingGlbBlob=null;var _pendingImgBlob=null;
  function doUpload(){if(!upForm.library){alert('请选择专题库');return;}
    var lib=libs.value.find(function(l){return l.name===upForm.library;});
    var prefix=lib?lib.prefix:'GEN';
    var libCount=relics.value.filter(function(r){return r.library===upForm.library;}).length+1;
    var seq=String(libCount).padStart(5,'0');
    var newId=prefix+'-2026-'+seq;
    var hasGlb=_pendingGlbBlob?true:false;
    var hasImg=_pendingImgBlob?true:false;
    var imgIdbKey=hasImg?'idb://imgFiles/'+newId:'';
    var newRelic={id:newId,name:upForm.name||('代号'+seq),type:upForm.type,imgBefore:hasImg?imgIdbKey:relicImg(upForm.type,libCount),imgCleaned:'',imgDuring:'',imgAfter:'',library:upForm.library,site:upForm.site||'待补充',era:upForm.era||'待确认',size:upForm.size||('高'+(Math.floor(Math.random()*30)+15)+'cm'),weight:upForm.weight||((Math.random()*2+0.3).toFixed(2)+'kg'),uploadedBy:currentUser.name,uploadTime:new Date().toLocaleString('zh-CN'),status:'已上传',restorer:'',progress:0,deadline:'',lastUpdate:'',disease:upForm.disease||'待记录',has3D:hasGlb,glbRestored:'',glbUnrestored:hasGlb?('idb://glbFiles/'+newId+'_unrestored'):'',glbRestoredName:'',glbUnrestoredName:hasGlb?upForm.glbName:'','_glbUnrestoredIdbKey':hasGlb?newId+'_unrestored':'',userUploaded:true};
    var savePromises=[];
    if(hasGlb)savePromises.push(idbSave('glbFiles',newId+'_unrestored',_pendingGlbBlob).catch(function(e){console.warn('GLB IDB save failed:',e);}));
    if(hasImg)savePromises.push(idbSave('imgFiles',newId,_pendingImgBlob).catch(function(e){console.warn('Img IDB save failed:',e);}));
    Promise.all(savePromises).then(function(){
      if(hasImg)resolveIdbUrl(imgIdbKey).then(function(url){if(url)resolvedImgs[newId]=url;});
    });
    relics.value.unshift(newRelic);
    var saved=loadUserRelics();saved.unshift(newRelic);saveUserRelics(saved);
    if(lib)lib.count++;
    _pendingGlbBlob=null;_pendingImgBlob=null;
    showUploadModal.value=false;upForm.name='';upForm.era='';upForm.site='';upForm.size='';upForm.weight='';upForm.disease='';upForm.glbUrl='';upForm.glbName='';upForm.has3D=false;upForm.imgUrl='';upForm.imgName='';
    alert('上传成功！编号：'+newId);
  }

  var showAssignModal=ref(false);var assignTarget=ref(null);var assignForm=reactive({restorer:'',deadline:'',priority:'中',req:''});
  var restorers=computed(function(){return allUsers.value.filter(function(u){return u.roleName==='修复师';}).slice(0,20).map(function(u){return u.name;});});
  function openAssign(r){assignTarget.value=r;assignForm.restorer='';assignForm.deadline='';assignForm.priority='中';assignForm.req='';showAssignModal.value=true;}
  function confirmAssign(){
    if(!assignForm.restorer||!assignForm.deadline){alert('请选择修复师并设定期限');return;}
    var r=assignTarget.value;
    r.restorer=assignForm.restorer;
    r.deadline=assignForm.deadline;
    r.status='待修复';
    r.progress=0;
    r.lastUpdate=new Date().toLocaleString('zh-CN');
    saveRelicChange(r);
    showAssignModal.value=false;
    alert('\u5df2\u5c06\u7f16\u53f7 '+r.id+' \u5206\u914d\u7ed9\u4fee\u590d\u5e08 '+assignForm.restorer);
  }

  var traceSearch=ref('');var traceResult=ref(null);
  function doTrace(){
    if(!traceSearch.value){alert('请输入文物编号');return;}
    var r=relics.value.find(function(x){return x.id===traceSearch.value;});
    if(!r){traceResult.value=null;alert('未找到匹配的文物');return;}
    traceResult.value={id:r.id,chain:[
      {step:'1 建立专题库',time:r.uploadTime.split(' ')[0],desc:'创建'+r.library,person:'赖文博',role:'项目负责人',terminal:'Web端'},
      {step:'2 扫描上传',time:r.uploadTime,desc:'移动端扫描上传',person:r.uploadedBy,role:'现场工作人员',terminal:'移动端'},
      {step:'3 数据审核',time:r.uploadTime,desc:'审核通过',person:'龙强',role:'Web端管理员',terminal:'Web端'},
    ].concat(r.restorer?[{step:'4 修复分配',time:'',desc:'分配给修复师',person:'董莹',role:'修复部门负责人',terminal:'Web端'}]:[])
    .concat(r.status==='修复中'||r.status==='已修复'?[{step:'5 修复执行',time:r.lastUpdate,desc:'进度'+r.progress+'%',person:r.restorer,role:'修复师',terminal:'移动端'}]:[])
    .concat(r.status==='已修复'?[{step:'6 验收确认',time:'',desc:'验收通过',person:'朱杰慧',role:'修复委员会',terminal:'Web端'},{step:'7 归档跟踪',time:'',desc:'修复档案归档',person:'秦浩然',role:'档案管理员',terminal:'Web端'}]:[])};
  }

  var monSearch=ref('');var monStage=ref('');var monStatus=ref('');
  function stageLabel(p){if(p<30)return '初期清洗';if(p<70)return '中期修复';return '后期收尾';}
  function stageFullLabel(r){
    if(r.status==='待修复')return '待修复';
    if(r.status==='修复中')return stageLabel(r.progress);
    if(r.status==='已修复')return '已修复';
    return r.status;
  }
  // Get all completed stage images — show images for stages that have been reached
  function completedStageImgs(r){
    if(!r)return [];
    var list=[];
    // Stage 1: excavated (always shown if uploaded)
    if(r.imgBefore){
      list.push({img:r.imgBefore,key:r.id,filter:'',label:'刚出土 · 病害记录'});
    }
    // Stage 2: cleaned (shown if reached 待修复 or beyond)
    if(r.status==='待修复'||r.status==='修复中'||r.status==='已修复'){
      var cleaned=r.imgCleaned;
      var cleanedKey=cleaned?r.id+'_cleaned':r.id;
      var cleanedSrc=cleaned||r.imgBefore;
      list.push({img:cleanedSrc,key:cleanedKey,filter:stageFilter('cleaned'),label:'清理后 · 初步处理'});
    }
    // Stage 3: during repair (shown if reached 修复中)
    if(r.status==='修复中'||r.status==='已修复'){
      var during=r.imgDuring;
      var duringKey=during?r.id+'_during':r.id;
      var duringSrc=during||r.imgBefore;
      list.push({img:duringSrc,key:duringKey,filter:stageFilter('during'),label:'修复中 · 过程记录'});
    }
    // Stage 4: after repair (shown only if 已修复)
    if(r.status==='已修复'){
      var after=r.imgAfter;
      var afterKey=after?r.id+'_after':r.id;
      var afterSrc=after||r.imgBefore;
      list.push({img:afterSrc,key:afterKey,filter:stageFilter('after'),label:'修复后 · 修复完成'});
    }
    return list;
  }
  var filteredMonitor=computed(function(){return scopedRelics.value.filter(function(r){
    if(r.status!=='修复中'&&r.status!=='待修复')return false;
    if(monStatus.value==='待修复'&&r.status!=='待修复')return false;
    if(monStatus.value==='修复中'&&r.status!=='修复中')return false;
    if(monSearch.value){var s=monSearch.value;if(r.id.indexOf(s)<0&&r.restorer.indexOf(s)<0)return false;}
    if(r.status==='待修复'){
      if(monStage.value==='初期'||monStage.value==='中期'||monStage.value==='后期')return false;
      return true;
    }
    if(monStage.value==='初期'&&r.progress>=30)return false;
    if(monStage.value==='中期'&&(r.progress<30||r.progress>=70))return false;
    if(monStage.value==='后期'&&r.progress<70)return false;
    return true;
  });});
  var monitorPendingCount=computed(function(){return filteredMonitor.value.filter(function(r){return r.status==='待修复';}).length;});
  var monitorRepairingCount=computed(function(){return filteredMonitor.value.filter(function(r){return r.status==='修复中';}).length;});

  // Stage image upload wrapper: shows modal, then performs the transition
  var _stageCallback=null;
  function startRepair(r){
    _stageCallback=function(){
      r.status='修复中';
      r.progress=Math.max(r.progress||0,10);
      r.lastUpdate=new Date().toLocaleString('zh-CN');
      saveRelicChange(r);
      alert('已开始修复 '+r.id+'，状态更新为修复中');
    };
    openStageImgModal(r,'imgCleaned','清理后图片');
  }
  function advanceStage(r){
    if(r.status==='待修复'){
      startRepair(r);
      return;
    }
    if(r.status==='修复中'){
      if(r.progress<30){
        r.progress=30;
        r.lastUpdate=new Date().toLocaleString('zh-CN');
        saveRelicChange(r);
        alert(r.id+' 已进入中期修复阶段 (30%)');
      }else if(r.progress<70){
        r.progress=70;
        r.lastUpdate=new Date().toLocaleString('zh-CN');
        saveRelicChange(r);
        alert(r.id+' 已进入后期收尾阶段 (70%)');
      }else{
        completeRepair(r);
      }
    }
  }
  function setProgress(r,val){
    val=Math.max(0,Math.min(100,parseInt(val)||0));
    if(val>=100){
      // Reaching 100% requires completing the repair with image upload
      completeRepair(r);
      return;
    }
    r.progress=val;
    r.lastUpdate=new Date().toLocaleString('zh-CN');
    if(val>0&&r.status==='待修复'){
      r.status='修复中';
    }
    saveRelicChange(r);
  }
  function completeRepair(r){
    _stageCallback=function(){
      r.status='已修复';
      r.progress=100;
      r.lastUpdate=new Date().toLocaleString('zh-CN');
      saveRelicChange(r);
      alert(r.id+' 修复完成！已标记为已修复');
    };
    openStageImgModal(r,'imgAfter','修复完成后图片');
  }

  var _initPending=[{id:'U101',name:'王新员',workId:'CQ-101',phone:'13800000101',email:'wang@example.com',department:'修复部',roleId:'restorer',roleName:'修复师',regTime:'2026-08-23 09:30',status:'待审核',scope:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false}}];
  var _savedReg=loadRegUsers();if(_savedReg&&_savedReg.length)_initPending=_initPending.concat(_savedReg);
  var pendingUsers=ref(_initPending);
  var activeUsers=computed(function(){return allUsers.value.filter(function(u){return u.status!=='待审核';});});
  var userSearch=ref('');
  var filteredUsers=computed(function(){return activeUsers.value.filter(function(u){if(!userSearch.value)return true;return u.name.indexOf(userSearch.value)>=0||u.workId.indexOf(userSearch.value)>=0||u.department.indexOf(userSearch.value)>=0;}).slice(0,50);});
  var showUserModal=ref(false);var newUser=reactive({name:'',workId:'',roleId:'restorer',department:'',phone:''});
  function createUser(){if(!newUser.name||!newUser.workId){alert('请填写姓名和工号');return;}
    var role=roles.find(function(r){return r.id===newUser.roleId;});
    allUsers.value.push({id:'U'+Date.now(),name:newUser.name,workId:newUser.workId,nickname:newUser.name,roleId:newUser.roleId,roleName:role?role.name:'',department:newUser.department||'待分配',phone:newUser.phone||'未填写',status:'正常',lastLogin:'未登录',scope:'全部文物',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});
    saveAllUsers(allUsers.value);
    showUserModal.value=false;newUser.name='';newUser.workId='';newUser.department='';newUser.phone='';
  }
  function toggleStatus(u){u.status=u.status==='正常'?'禁用':'正常';saveAllUsers(allUsers.value);}

  var showAuditModal=ref(false);var auditTarget=ref(null);
  var permList=[{key:'view',label:'查看文物数据'},{key:'edit',label:'编辑文物信息'},{key:'delete',label:'删除文物'},{key:'audit',label:'审核上传数据'},{key:'assign',label:'分配修复任务'}];
  var auditForm=reactive({scope:'全部文物',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});
  function openAudit(u){auditTarget.value=u;auditForm.scope='全部文物';auditForm.perms={view:true,edit:false,delete:false,audit:false,assign:false};showAuditModal.value=true;}
  function rejectUser(u){var idx=pendingUsers.value.findIndex(function(x){return x.id===u.id;});if(idx>-1)pendingUsers.value.splice(idx,1);var regUsers=loadRegUsers();regUsers=regUsers.filter(function(x){return x.id!==u.id;});saveRegUsers(regUsers);alert('用户「'+u.name+'」的注册申请已驳回');}
  function rejectFromAudit(){if(auditTarget.value){rejectUser(auditTarget.value);showAuditModal.value=false;}}

  var showPermModal=ref(false);var permTarget=ref(null);
  function openPermModal(u){permTarget.value=u;showPermModal.value=true;}

  // AI Repair Analysis module
  var aiSearch=ref('');var aiRelic=ref(null);var aiAnalyzing=ref(false);var aiResult=ref(null);
  function aiAnalyze(){
    if(!aiSearch.value){alert('请输入文物编号');return;}
    var r=relics.value.find(function(x){return x.id===aiSearch.value;});
    if(!r){alert('未找到该文物编号，请检查后重试');return;}
    aiRelic.value=r;aiAnalyzing.value=true;aiResult.value=null;
    setTimeout(function(){
      var type=r.type;var disease=r.disease;var era=r.era;var site=r.site;
      // Pathology database by type
      var pathologyDB={
        '青铜器':{
          factors:['电化学腐蚀（埋藏环境中土壤酸碱度导致青铜基体氧化）','氯离子侵蚀（土壤中可溶性盐迁移至器物内部）','有害锈（粉状锈，碱式氯化铜不断蔓延扩展）','机械应力损伤（出土时挤压变形导致结构脆弱）'],
          risks:['若不及时脱盐处理，粉状锈将在3-6个月内扩散至全器','器壁薄弱处存在断裂风险，需 immobilization 固定','表面铭文及纹饰面临不可逆损失'],
          techniques:['电化学脱盐法（5%碳酸钠溶液，恒电流0.5A/m²，周期7-14天）','机械除锈（手术刀+超声波微型工具，精准去除有害锈）','缓蚀处理（BTA乙醇溶液浸泡，浓度3%，时长72小时）','表面封护（Paraloid B-72 2%丙酮溶液涂刷）'],
          materials:['碳酸钠（脱盐）、BTA苯并三氮唑（缓蚀）、Paraloid B-72（封护）、丙酮（溶剂）'],
          tools:['超声波清洗机、恒电位仪、手术刀组、体视显微镜、红外热像仪'],
          estDays:Math.floor(srand(r.id.charCodeAt(0)+r.id.length)*15)+12,
          priority:disease.indexOf('严重')>=0||disease.indexOf('断裂')>=0?'紧急':'高'
        },
        '石质':{
          factors:['水蚀风化（雨水及地下水溶蚀碳酸盐胶结物）','生物侵蚀（苔藓、地衣分泌物产生有机酸腐蚀）','盐结晶破坏（可溶盐反复结晶溶解导致表层剥落）','冻融循环损伤（水分渗入裂隙后冻胀扩展）'],
          risks:['风化层持续加深，表面雕刻细节将完全消失','裂隙扩展可能导致块体断裂脱落','盐害若不处理将导致粉化剥落不可逆'],
          techniques:['表面清洗（微粒子喷射技术，CaCO₃粉末，压力0.3bar）','裂隙注浆（环氧树脂+石粉调配，颜色匹配石材）','防水加固（硅酸乙酯渗透加固，浓度5%）','生物灭杀（季铵盐类生物抑制剂，涂刷3遍）'],
          materials:['CaCO₃微粒子（喷射）、环氧树脂（注浆）、硅酸乙酯（加固）、季铵盐（生物灭杀）'],
          tools:['微粒子喷射机、注浆器、红外水分仪、色差仪、裂隙测宽仪'],
          estDays:Math.floor(srand(r.id.charCodeAt(0)+r.id.length)*20)+18,
          priority:disease.indexOf('缺损')>=0||disease.indexOf('风化')>=0?'高':'中'
        },
        '金质':{
          factors:['表面氧化变色（银铜合金中铜元素优先氧化）','金箔脱落（胎体与金箔结合层老化失效）','机械变形（薄壁结构在出土时受压变形）','残孔腐蚀（基体金属晶间腐蚀导致微孔）'],
          risks:['金箔脱落面积将持续扩大，影响器物完整性','变形部位应力集中可能导致二次断裂','氧化层若不稳定将继续向基体深入'],
          techniques:['热处理整形（低温退火，150-200°C，逐步校正变形）','金箔回贴（鱼鳔胶+金箔重新贴合，需湿度控制）','表面钝化（柠檬酸溶液弱酸清洗，去除氧化层）','微束等离子焊接（修复断裂部位）'],
          materials:['鱼鳔胶（金箔回贴）、柠檬酸（清洗）、金箔补配材料、氩气（焊接保护）'],
          tools:['微束等离子焊机、恒温加热台、体视显微镜、金箔压平工具、温湿度计'],
          estDays:Math.floor(srand(r.id.charCodeAt(0)+r.id.length)*12)+8,
          priority:disease.indexOf('脱落')>=0?'高':'中'
        },
        '陶瓷':{
          factors:['可溶盐结晶破坏（多孔结构内盐分反复结晶导致釉面剥落）','碎裂缺损（出土时机械冲击导致断裂、缺失）','釉面老化（长期埋藏导致釉层水解变得浑浊）','修补历史残留（早期不当修补材料老化污染）'],
          risks:['盐害持续作用下釉面将大面积剥落','断裂面若不稳定将继续扩展碎裂','早期修补材料老化可能进一步腐蚀胎体'],
          techniques:['脱盐处理（浸泡法+纸浆吸盐，周期2-4周，定期更换去离子水）','碎片粘接（HMG型环氧树脂+钛销钉加固）','补全做色（石膏补缺+丙烯颜料调色做旧）','釉面加固（硅酸乙酯渗透，恢复釉面光泽）'],
          materials:['去离子水（脱盐）、HMG环氧树脂（粘接）、石膏（补缺）、丙烯颜料（做色）、钛销钉（加固）'],
          tools:['恒温水浴锅、碎片拼接架、色差仪、UV紫外灯（检测修补痕迹）、牙科钻头'],
          estDays:Math.floor(srand(r.id.charCodeAt(0)+r.id.length)*18)+15,
          priority:disease.indexOf('碎裂')>=0||disease.indexOf('缺损')>=0?'高':'中'
        }
      };
      var db=pathologyDB[type]||pathologyDB['青铜器'];
      var diseaseList=disease.split(/[、，,]/).filter(function(s){return s.trim();});
      aiResult.value={
        relicId:r.id,
        type:type,
        era:era,
        site:site,
        disease:disease,
        diseaseItems:diseaseList,
        pathologyFactors:db.factors,
        riskAssessment:db.risks,
        techniques:db.techniques,
        materials:db.materials,
        tools:db.tools,
        estDays:db.estDays,
        priority:db.priority,
        confidence:Math.floor(srand(r.id.charCodeAt(1)+5)*15)+83,
        suggestions:[
          '建议在修复前进行全景三维扫描和X射线探伤，确定内部结构损伤范围',
          '修复环境需控温（18-22°C）控湿（RH 45-55%），避免环境波动引发二次损伤',
          '修复全过程需详细记录影像资料，建立修复前中后对比档案',
          '修复完成后定期跟踪监测（每季度一次），评估修复效果稳定性'
        ]
      };
      aiAnalyzing.value=false;
    },1800);
  }

  function analyzeRelicAI(r){
    if(!r)return;
    r.aiAnalyzing=true;r.aiResult=null;
    setTimeout(function(){
      var type=r.type;var disease=r.disease||'表面锈蚀、局部断裂';
      var pathologyDB={
        '青铜器':{
          factors:[{factor:'电化学腐蚀',desc:'埋藏环境中土壤酸碱度导致青铜基体氧化，产生 Cu₂O/CuO 层'},{factor:'氯离子侵蚀',desc:'土壤中可溶性盐迁移至器物内部，引发粉状锈（碱式氯化铜）'},{factor:'有害锈扩散',desc:'粉状锈不断蔓延扩展，导致器物表面酥粉化'},{factor:'机械应力损伤',desc:'出土时挤压变形导致结构脆弱，薄弱处存在断裂风险'}],
          risks:['若不及时脱盐处理，粉状锈将在3-6个月内扩散至全器','器壁薄弱处存在断裂风险，需固定支撑','表面铭文及纹饰面临不可逆损失'],
          suggestions:[{step:'电化学脱盐',detail:'5%碳酸钠溶液，恒电流0.5A/m²，周期7-14天'},{step:'机械除锈',detail:'手术刀+超声波微型工具，精准去除有害锈'},{step:'缓蚀处理',detail:'BTA乙醇溶液浸泡，浓度3%，时长72小时'},{step:'表面封护',detail:'Paraloid B-72 2%丙酮溶液涂刷封护'}],
          materials:['碳酸钠（脱盐）','BTA苯并三氮唑（缓蚀）','Paraloid B-72（封护）','丙酮（溶剂）'],
          tools:['超声波清洗机','恒电位仪','手术刀组','体视显微镜','红外热像仪'],
          estDays:45,priority:'高'
        },
        '石质':{
          factors:[{factor:'水蚀风化',desc:'雨水及地下水溶蚀碳酸盐胶结物，导致表面粉化脱落'},{factor:'生物侵蚀',desc:'苔藓、地衣分泌物产生有机酸腐蚀石材表面'},{factor:'盐结晶破坏',desc:'可溶盐反复结晶溶解导致表层剥落'},{factor:'冻融循环损伤',desc:'水分渗入裂隙后冻胀扩展，加速结构破坏'}],
          risks:['风化层持续加深，表面雕刻细节将完全消失','裂隙扩展可能导致块体断裂脱落','盐害若不处理将导致粉化剥落不可逆'],
          suggestions:[{step:'表面清洗',detail:'微粒子喷射技术，CaCO₃粉末，压力0.3bar'},{step:'裂隙注浆',detail:'环氧树脂+石粉调配，颜色匹配石材'},{step:'防水加固',detail:'硅酸乙酯渗透加固，浓度5%'},{step:'生物灭杀',detail:'季铵盐类生物抑制剂，涂刷3遍'}],
          materials:['CaCO₃微粒子','环氧树脂','硅酸乙酯','季铵盐'],
          tools:['微粒子喷射机','注浆器','红外水分仪','色差仪','裂隙测宽仪'],
          estDays:38,priority:'高'
        },
        '金质':{
          factors:[{factor:'表面氧化变色',desc:'银铜合金中铜元素优先氧化，导致表面颜色变化'},{factor:'金箔脱落',desc:'胎体与金箔结合层老化失效，金箔翘起脱落'},{factor:'机械变形',desc:'薄壁结构在出土时受压变形，存在应力集中'},{factor:'晶间腐蚀',desc:'基体金属晶间腐蚀导致微孔，影响结构强度'}],
          risks:['金箔脱落面积将持续扩大，影响器物完整性','变形部位应力集中可能导致二次断裂','氧化层若不稳定将继续向基体深入'],
          suggestions:[{step:'热处理整形',detail:'低温退火，150-200°C，逐步校正变形'},{step:'金箔回贴',detail:'鱼鳔胶+金箔重新贴合，需湿度控制'},{step:'表面钝化',detail:'柠檬酸溶液弱酸清洗，去除氧化层'},{step:'微束等离子焊接',detail:'修复断裂部位，氩气保护'}],
          materials:['鱼鳔胶','柠檬酸','金箔补配材料','氩气'],
          tools:['微束等离子焊机','恒温加热台','体视显微镜','金箔压平工具','温湿度计'],
          estDays:25,priority:'中'
        },
        '陶瓷':{
          factors:[{factor:'可溶盐结晶破坏',desc:'多孔结构内盐分反复结晶导致釉面剥落'},{factor:'碎裂缺损',desc:'出土时机械冲击导致断裂、缺失'},{factor:'釉面老化',desc:'长期埋藏导致釉层水解变得浑浊'},{factor:'修补历史残留',desc:'早期不当修补材料老化污染'}],
          risks:['盐害持续作用下釉面将大面积剥落','断裂面若不稳定将继续扩展碎裂','早期修补材料老化可能进一步腐蚀胎体'],
          suggestions:[{step:'脱盐处理',detail:'浸泡法+纸浆吸盐，周期2-4周，定期更换去离子水'},{step:'碎片粘接',detail:'HMG型环氧树脂+钛销钉加固'},{step:'补全做色',detail:'石膏补缺+丙烯颜料调色做旧'},{step:'釉面加固',detail:'硅酸乙酯渗透，恢复釉面光泽'}],
          materials:['去离子水','HMG环氧树脂','石膏','丙烯颜料','钛销钉'],
          tools:['恒温水浴锅','碎片拼接架','色差仪','UV紫外灯','牙科钻头'],
          estDays:30,priority:'中'
        }
      };
      var db=pathologyDB[type]||pathologyDB['青铜器'];
      r.aiResult={
        pathology:db.factors,
        risks:db.risks,
        suggestions:db.suggestions,
        materials:db.materials,
        tools:db.tools,
        estDays:db.estDays,
        priority:db.priority,
        confidence:Math.floor(srand(r.id.charCodeAt(1)+5)*15)+83,
        summary:'该文物（'+type+'类）存在'+disease+'等病害。建议优先进行无损检测（三维扫描+X射线探伤），确定内部结构损伤范围后制定修复方案。修复环境需控温（18-22°C）控湿（RH 45-55%），修复全过程需详细记录影像资料，建立修复前中后对比档案。修复完成后定期跟踪监测（每季度一次），评估修复效果稳定性。'
      };
      r.aiAnalyzing=false;
    },1800);
  }

  var restorerStats=computed(function(){
    var names=[...new Set(relics.value.filter(function(r){return r.restorer;}).map(function(r){return r.restorer;}))].slice(0,8);
    return names.map(function(name){
      var items=relics.value.filter(function(r){return r.restorer===name;});
      var done=items.filter(function(r){return r.status==='已修复';}).length;
      var repairing=items.filter(function(r){return r.status==='修复中';}).length;
      var total=items.length;
      var avgHours=Math.round(35+srand(name.charCodeAt(0)+name.length)*25);
      var delayed=repairing>0&&srand(name.charCodeAt(1)||1)>0.6?1:0;
      return{name:name,total:total,done:done,repairing:repairing,avgHours:avgHours,delayed:delayed,rate:total>0?Math.round(done/total*100):0};
    });
  });

  // Dynamic trend data from actual relic upload times
  var trendData=computed(function(){
    var days=['08-18','08-19','08-20','08-21','08-22','08-23','08-24'];
    return days.map(function(d){
      return relics.value.filter(function(r){return r.uploadTime.indexOf('2026-'+d)>=0;}).length;
    });
  });

  var chartStatus=ref(null),chartTrend=ref(null),chartWorkload=ref(null),chartType=ref(null),chartRepairStatus=ref(null),chartLib=ref(null),chartMonthly=ref(null);

  function statusPieData(){
    return [
      {value:sc('待上传'),name:'待上传',itemStyle:{color:'#EF4444'}},
      {value:sc('已上传'),name:'已上传',itemStyle:{color:'#F59E0B'}},
      {value:sc('待修复'),name:'待修复',itemStyle:{color:'#3B82F6'}},
      {value:sc('修复中'),name:'修复中',itemStyle:{color:'#10B981'}},
      {value:sc('已修复'),name:'已修复',itemStyle:{color:'#64748B'}}
    ];
  }

  function initCharts(){
    loadEcharts().then(function(ec){
      if(!ec){console.error('ECharts not loaded');return;}
      if(chartStatus.value){
        var ext=ec.getInstanceByDom(chartStatus.value);
        if(ext)ext.dispose();
        var c=ec.init(chartStatus.value);
        c.setOption({tooltip:{trigger:'item'},legend:{bottom:0,textStyle:{fontSize:11}},series:[{type:'pie',radius:['30%','60%'],emphasis:{itemStyle:{shadowBlur:20,shadowColor:'rgba(0,0,0,.3)'}},data:statusPieData(),label:{formatter:'{b}: {c}',fontSize:11}}]});
      }
      if(chartTrend.value){
        var ext2=ec.getInstanceByDom(chartTrend.value);
        if(ext2)ext2.dispose();
        var c2=ec.init(chartTrend.value);
        c2.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:['08-18','08-19','08-20','08-21','08-22','08-23','08-24']},yAxis:{type:'value'},series:[{type:'bar',data:trendData.value,itemStyle:{color:'#2563EB',borderRadius:[4,4,0,0]}}],grid:{left:'8%',right:'5%',top:'10%',bottom:'15%'}});
      }
    });
  }

  function initStatsCharts(){
    loadEcharts().then(function(ec){
      if(!ec){console.error('ECharts not loaded');return;}
      if(chartType.value){
        var e0=ec.getInstanceByDom(chartType.value);if(e0)e0.dispose();
        var c=ec.init(chartType.value);
        var td={};
        relics.value.forEach(function(r){td[r.type]=(td[r.type]||0)+1;});
        c.setOption({tooltip:{trigger:'item'},legend:{bottom:0,textStyle:{fontSize:11}},series:[{type:'pie',radius:['30%','60%'],data:Object.entries(td).map(function(e){return{name:e[0],value:e[1]};}),label:{formatter:'{b}: {c}',fontSize:11}}]});
      }
      if(chartRepairStatus.value){
        var e1=ec.getInstanceByDom(chartRepairStatus.value);if(e1)e1.dispose();
        var c2=ec.init(chartRepairStatus.value);
        c2.setOption({tooltip:{trigger:'item'},legend:{bottom:0,textStyle:{fontSize:11}},series:[{type:'pie',radius:['30%','60%'],data:statusPieData(),label:{formatter:'{b}: {c}',fontSize:11}}]});
      }
      if(chartLib.value){
        var e2=ec.getInstanceByDom(chartLib.value);if(e2)e2.dispose();
        var c3=ec.init(chartLib.value);
        c3.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:libs.value.map(function(l){return l.name;}),axisLabel:{rotate:45,fontSize:10}},yAxis:{type:'value'},series:[{type:'bar',data:libs.value.map(function(l){return l.count;}),itemStyle:{color:'#7C3AED',borderRadius:[4,4,0,0]}}],grid:{left:'8%',right:'5%',top:'10%',bottom:'30%'}});
      }
      if(chartMonthly.value){
        var e3=ec.getInstanceByDom(chartMonthly.value);if(e3)e3.dispose();
        var c4=ec.init(chartMonthly.value);
        c4.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:['3月','4月','5月','6月','7月','8月']},yAxis:{type:'value'},series:[{type:'line',data:[1820,2350,2180,2890,3120,relics.value.length],smooth:true,itemStyle:{color:'#2563EB'},areaStyle:{opacity:.1}}],grid:{left:'8%',right:'5%',top:'10%',bottom:'15%'}});
      }
      if(chartWorkload.value){
        var e4=ec.getInstanceByDom(chartWorkload.value);if(e4)e4.dispose();
        var c5=ec.init(chartWorkload.value);
        c5.setOption({tooltip:{trigger:'axis'},legend:{data:['已完成','修复中']},xAxis:{type:'category',data:restorerStats.value.map(function(r){return r.name;}),axisLabel:{rotate:30,fontSize:10}},yAxis:{type:'value'},series:[{name:'已完成',type:'bar',data:restorerStats.value.map(function(r){return r.done;}),itemStyle:{color:'#10B981',borderRadius:[4,4,0,0]}},{name:'修复中',type:'bar',data:restorerStats.value.map(function(r){return r.repairing;}),itemStyle:{color:'#F59E0B',borderRadius:[4,4,0,0]}}],grid:{left:'8%',right:'5%',top:'15%',bottom:'25%'}});
      }
    });
  }

  function onPageEntered(){
    var v=page.value;
    if(v==='statistics'||v==='monitor')initStatsCharts();
    else if(v==='dashboard')initCharts();
  }

  // 3D Model Viewer
  var model3DMode=ref('restored');
  var loading3D=ref(false);
  var _viewer3D={scene:null,camera:null,renderer:null,controls:null,model:null,animId:null};

  function initViewer3D(){
    var s=sel.value;
    if(!s||!s.has3D)return;
    var glbPath=model3DMode.value==='restored'?s.glbRestored:s.glbUnrestored;
    if(!glbPath&&model3DMode.value==='restored'&&s.glbUnrestored){model3DMode.value='unrestored';glbPath=s.glbUnrestored;}
    if(!glbPath){alert('该文物暂无'+(model3DMode.value==='restored'?'已修复':'待修复')+'3D模型');return;}
    loading3D.value=true;
    if(_viewer3D.animId){cancelAnimationFrame(_viewer3D.animId);_viewer3D.animId=null;}
    var container=document.getElementById('viewer3d-container');
    if(!container)return;
    var oldCanvas=document.getElementById('viewer3d-canvas');
    if(oldCanvas)oldCanvas.remove();
    var canvas=document.createElement('canvas');
    canvas.id='viewer3d-canvas';
    canvas.style.cssText='width:100%;height:100%';
    container.appendChild(canvas);

    setTimeout(function(){
      try{
        var w=container.clientWidth||640;
        var h=container.clientHeight||480;
        _viewer3D.scene=new THREE.Scene();
        _viewer3D.scene.background=new THREE.Color(0xEFF4FA);
        _viewer3D.camera=new THREE.PerspectiveCamera(45,w/h,0.1,1000);
        _viewer3D.camera.position.set(2.5,2,4.5);
        _viewer3D.renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true});
        _viewer3D.renderer.setSize(w,h);
        _viewer3D.renderer.setPixelRatio(window.devicePixelRatio||1);
        if(THREE.SRGBColorSpace)_viewer3D.renderer.outputColorSpace=THREE.SRGBColorSpace;
        var amb=new THREE.AmbientLight(0xffffff,0.6);
        _viewer3D.scene.add(amb);
        var dir1=new THREE.DirectionalLight(0xffffff,0.8);
        dir1.position.set(5,10,5);_viewer3D.scene.add(dir1);
        var dir2=new THREE.DirectionalLight(0xffffff,0.3);
        dir2.position.set(-5,3,-5);_viewer3D.scene.add(dir2);
        var grid=new THREE.GridHelper(10,20,0xCBD5E1,0xE2E8F0);
        _viewer3D.scene.add(grid);
        var OrbitC=THREE.OrbitControls||window.THREE_OrbitControls;
        if(OrbitC){_viewer3D.controls=new OrbitC(_viewer3D.camera,_viewer3D.renderer.domElement);_viewer3D.controls.enableDamping=true;_viewer3D.controls.dampingFactor=0.08;}
        var LoaderC=THREE.GLTFLoader||window.THREE_GLTFLoader;
        if(LoaderC){
          var loader=new LoaderC();
          var DracoC=THREE.DRACOLoader||window.THREE_DRACOLoader;
          if(DracoC){var draco=new DracoC();draco.setDecoderPath('draco/');loader.setDRACOLoader(draco);}
          resolveIdbUrl(glbPath).then(function(resolvedUrl){
          if(!resolvedUrl){loading3D.value=false;alert('3D模型文件未找到，可能已被清除');return;}
          var progBar=document.getElementById('viewer3d-progress');
          loader.load(resolvedUrl,function(gltf){
            _viewer3D.model=gltf.scene;
            var box=new THREE.Box3().setFromObject(_viewer3D.model);
            var size=box.getSize(new THREE.Vector3());
            var center=box.getCenter(new THREE.Vector3());
            var maxDim=Math.max(size.x,size.y,size.z)||1;
            var sc=2/maxDim;
            _viewer3D.model.scale.setScalar(sc);
            var boxScaled=new THREE.Box3().setFromObject(_viewer3D.model);
            var minY=boxScaled.min.y;
            _viewer3D.model.position.x=-center.x*sc;
            _viewer3D.model.position.y=-minY;
            _viewer3D.model.position.z=-center.z*sc;
            _viewer3D.scene.add(_viewer3D.model);
            loading3D.value=false;
            function animate(){_viewer3D.animId=requestAnimationFrame(animate);if(_viewer3D.controls)_viewer3D.controls.update();_viewer3D.renderer.render(_viewer3D.scene,_viewer3D.camera);}
            animate();
          },function(xhr){
            if(xhr.lengthComputable){
              var pct=Math.round(xhr.loaded/xhr.total*100);
              var pb=document.getElementById('viewer3d-progress');
              var sp=document.getElementById('viewer3d-status');
              if(pb)pb.style.width=pct+'%';
              if(sp)sp.textContent='加载3D模型中... '+pct+'%';
            }
          },function(err){console.error('GLB load error:',err);loading3D.value=false;var sp=document.getElementById('viewer3d-status');if(sp)sp.textContent='3D模型加载失败: '+(err.message||err);});
          });
        }else{loading3D.value=false;console.error('GLTFLoader not available');}
      }catch(e){console.error('3D init error:',e);loading3D.value=false;}
    },100);
  }

  function switch3DMode(mode){
    if(mode==='unrestored'&&!sel.value?.glbUnrestored)return;
    model3DMode.value=mode;
    if(dTab.value==='3d'){initViewer3D();}
  }

  watch(dTab,function(v){if(v==='3d'){model3DMode.value='restored';nextTick(function(){setTimeout(initViewer3D,200);});}});

  function onGLBUpload(e){
    var file=e.target.files[0];
    if(!file)return;
    if(file.size>100*1024*1024){alert('GLB文件过大（超过100MB），请先压缩');e.target.value='';return;}
    _pendingGlbBlob=file;
    upForm.glbUrl='pending';upForm.glbName=file.name;upForm.has3D=true;
  }

  function onImgUpload(e){
    var file=e.target.files[0];
    if(!file)return;
    if(file.size>10*1024*1024){alert('图片过大（超过10MB），请压缩');e.target.value='';return;}
    _pendingImgBlob=file;
    upForm.imgUrl='pending';upForm.imgName=file.name;
  }

  function onRelicGLBUpload(e,type){
    var file=e.target.files[0];
    if(!file)return;
    if(file.size>100*1024*1024){alert('GLB文件过大（超过100MB），请先压缩');e.target.value='';return;}
    var idbKey=sel.value.id+'_'+type;
    var blobUrl=URL.createObjectURL(file);
    if(type==='restored'){
      sel.value.glbRestored=blobUrl;
      sel.value.glbRestoredName=file.name;
      sel.value.has3D=true;
      sel.value._glbRestoredIdbKey=idbKey;
      model3DMode.value='restored';
    }else{
      sel.value.glbUnrestored=blobUrl;
      sel.value.glbUnrestoredName=file.name;
      sel.value.has3D=true;
      sel.value._glbUnrestoredIdbKey=idbKey;
    }
    updateUserRelicInStorage(sel.value);
    idbSave('glbFiles',idbKey,file).catch(function(e){console.warn('IDB save failed:',e);});
    alert((type==='restored'?'已修复':'待修复')+'3D模型上传成功，正在加载...');
    initViewer3D();
  }

  // Stage image upload modal
  var showStageImgModal=ref(false);
  var stageImgTarget=ref(null);
  var stageImgField=ref('');
  var stageImgLabel=ref('');
  var _pendingStageImgBlob=null;
  function openStageImgModal(r,field,label){
    stageImgTarget.value=r;
    stageImgField.value=field;
    stageImgLabel.value=label;
    _pendingStageImgBlob=null;
    showStageImgModal.value=true;
  }
  function onStageImgUpload(e){
    var file=e.target.files[0];
    if(!file)return;
    if(file.size>10*1024*1024){alert('图片过大（超过10MB），请压缩');e.target.value='';return;}
    _pendingStageImgBlob=file;
  }
  function confirmStageImg(){
    var r=stageImgTarget.value;
    if(!r)return;
    if(!_pendingStageImgBlob){
      alert('请选择图片文件');
      return;
    }
    var field=stageImgField.value;
    var idbKey=r.id+'_'+field;
    var blobUrl=URL.createObjectURL(_pendingStageImgBlob);
    // Save idb:// URL in the relic field for persistence across refreshes
    r[field]='idb://imgFiles/'+idbKey;
    r['_'+field+'IdbKey']=idbKey;
    r.lastUpdate=new Date().toLocaleString('zh-CN');
    // Resolve for immediate display
    if(field==='imgBefore')resolvedImgs[r.id]=blobUrl;
    else if(field==='imgCleaned')resolvedImgs[r.id+'_cleaned']=blobUrl;
    else if(field==='imgDuring')resolvedImgs[r.id+'_during']=blobUrl;
    else if(field==='imgAfter')resolvedImgs[r.id+'_after']=blobUrl;
    saveRelicChange(r);
    idbSave('imgFiles',idbKey,_pendingStageImgBlob).catch(function(e){console.warn('Stage img IDB save failed:',e);});
    showStageImgModal.value=false;
    _pendingStageImgBlob=null;
    // Execute the stage transition callback
    if(_stageCallback){var cb=_stageCallback;_stageCallback=null;cb();}
  }
  function cancelStageImg(){
    showStageImgModal.value=false;
    _pendingStageImgBlob=null;
    _stageCallback=null;
  }

  // --- Cloud Sync UI State ---
  var ghConfig=ref(loadGhConfig());
  var netlifyApiUrl=ref(loadNetlifyConfig());
  var ghSyncMsg=ref('');
  var ghSyncing=ref(false);
  function saveCloudConfig(){
    var cfg={
      owner:ghConfig.value.owner.trim(),
      repo:ghConfig.value.repo.trim(),
      branch:ghConfig.value.branch.trim(),
      dataDir:ghConfig.value.dataDir.trim(),
      token:ghConfig.value.token.trim()
    };
    saveGhConfig(cfg);
    ghConfig.value=cfg;
    // Save Netlify API URL
    var nUrl=netlifyApiUrl.value.trim();
    saveNetlifyConfig(nUrl);
    _netlifyApiUrl=nUrl; // reset cache so it picks up the new value
    ghSyncMsg.value='配置已保存';
    setTimeout(function(){ghSyncMsg.value='';},3000);
  }
  function testCloudPull(){
    ghSyncing.value=true;
    ghSyncMsg.value='正在测试拉取...';
    var pullFn=hasNetlifyBackend()?pullKeyFromNetlify:pullKeyFromGh;
    pullFn(USER_RELICS_KEY,function(ok){
      ghSyncing.value=false;
      ghSyncMsg.value=ok?'✓ 拉取成功，可以读取云端数据':'✗ 拉取失败，请检查配置';
    });
  }
  function testCloudPush(){
    if(!hasNetlifyBackend()&&!ghConfig.value.token){
      ghSyncMsg.value='请先配置 Netlify API 地址或 GitHub Token';
      return;
    }
    ghSyncing.value=true;
    ghSyncMsg.value='正在测试写入...';
    var pushFn=hasNetlifyBackend()?pushKeyToNetlify:pushKeyToGh;
    pushFn(USER_RELICS_KEY,function(ok,err){
      ghSyncing.value=false;
      ghSyncMsg.value=ok?'✓ 写入成功，云端同步已启用':'✗ 写入失败: '+(err||'未知错误');
    });
  }
  function manualPullAll(){
    ghSyncing.value=true;
    ghSyncMsg.value='正在从云端拉取所有数据...';
    syncAllFromServer(function(){
      ghSyncing.value=false;
      ghSyncMsg.value='✓ 数据拉取完成，页面即将刷新';
      setTimeout(function(){location.reload();},1500);
    });
  }
  function manualPushAll(){
    if(!hasNetlifyBackend()&&!ghConfig.value.token){
      ghSyncMsg.value='请先配置 Netlify API 地址或 GitHub Token';
      return;
    }
    ghSyncing.value=true;
    ghSyncMsg.value='正在推送所有数据到云端...';
    var done=0;
    _syncKeys.forEach(function(k){
      var pushFn=hasNetlifyBackend()?pushKeyToNetlify:pushKeyToGh;
      pushFn(k,function(){
        done++;
        if(done===_syncKeys.length){
          ghSyncing.value=false;
          ghSyncMsg.value='✓ 所有数据已推送到云端';
          setTimeout(function(){ghSyncMsg.value='';},3000);
        }
      });
    });
  }

  // Manual refresh function — pull latest data from server and update UI
  function refreshFromServer(){
    syncAllFromServer(function(){
      try{
        var _o=loadRelicOverrides();
        var _ur2=loadUserRelics();
        var _gr2=genRelics();
        var _all2=_ur2.concat(_gr2);
        _all2.forEach(function(r){var o2=_o[r.id];if(o2){for(var kk in o2){r[kk]=o2[kk];}}});
        relics.value.splice(0,relics.value.length);
        _all2.forEach(function(r){relics.value.push(r);});
        var _su3=loadAllUsers();
        if(_su3){allUsers.value.splice(0,allUsers.value.length);_su3.forEach(function(u){allUsers.value.push(u);});}
        var _sl3=loadLibs();
        if(_sl3){libs.value.splice(0,libs.value.length);_sl3.forEach(function(l){libs.value.push(l);});}
        resolveAllIdbImgs();
      }catch(e){}
    });
  }

  return{loggedIn,authMode,loginForm,loginErr,doLogin,regForm,regErr,regRoles,doRegister,logout,currentUser,
    page,pageTitle,nav,types,libs,relics,allUsers,
    canManageUsers,canViewStats,canViewAI,canAssign,canEdit,canDelete,canAudit,scopedRelics,
    fStatus,fType,fLib,search,filteredRelics,pageSize,curPage,totalPages,visiblePages,pagedRelics,sc,sb,repairingCount,pendingCount,
    assignSearch,filteredAssignRelics,pendingAssignRelics,refreshFromServer,
    showNoti,notifications,pendingItems,sel,dTab,selTimeline,selChain,repairLogs,viewRelic,
    showLibModal,newLib,createLib,filterByLib,showUploadModal,upForm,doUpload,
    showAssignModal,assignTarget,assignForm,restorers,openAssign,confirmAssign,
    traceSearch,traceResult,doTrace,
    monSearch,monStage,monStatus,filteredMonitor,stageLabel,stageFullLabel,completedStageImgs,monitorPendingCount,monitorRepairingCount,
    startRepair,advanceStage,setProgress,completeRepair,
    myPendingTotal,myRepairingCount,myPendingRepairCount,myDoneCount,
    pendingUsers,activeUsers,userSearch,filteredUsers,showUserModal,newUser,createUser,toggleStatus,
    showAuditModal,auditTarget,permList,auditForm,openAudit,approveUser,rejectUser,rejectFromAudit,
    showPermModal,permTarget,openPermModal,restorerStats,roles,onPageEntered,
    aiSearch,aiRelic,aiAnalyzing,aiResult,aiAnalyze,analyzeRelicAI,
    model3DMode,loading3D,switch3DMode,initViewer3D,onGLBUpload,onRelicGLBUpload,onImgUpload,
    chartStatus,chartTrend,chartWorkload,chartType,chartRepairStatus,chartLib,chartMonthly,
    resolvedImgs,latestImg,imgFallback,delRelic,openEditRestorer,saveEditRestorer,showEditRestorerModal,editRestorerTarget,editRestorerForm,showNicknameModal,nickInput,roleApply,permApply,openNicknameModal,saveNickname,
    showStageImgModal,stageImgTarget,stageImgField,stageImgLabel,onStageImgUpload,confirmStageImg,cancelStageImg,
    relicFilter,relicStyle,relicStyleThumb,stageFilter,
    ghConfig,netlifyApiUrl,ghSyncMsg,ghSyncing,saveCloudConfig,testCloudPull,testCloudPush,manualPullAll,manualPushAll};
}}).mount('#app');
