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
function saveUserRelics(relics){
  try{localStorage.setItem(USER_RELICS_KEY,JSON.stringify(relics));}catch(e){console.error('Save failed:',e);}
}
function loadUserRelics(){
  try{var s=localStorage.getItem(USER_RELICS_KEY);return s?JSON.parse(s):[];}catch(e){return[];}
}
function updateUserRelicInStorage(relic){
  if(!relic||!relic.userUploaded)return;
  var saved=loadUserRelics();
  var idx=saved.findIndex(function(r){return r.id===relic.id;});
  var copy={};for(var k in relic){if(typeof relic[k]!=='object'||relic[k]===null){copy[k]=relic[k];}else if(Array.isArray(relic[k])){copy[k]=relic[k].slice();}}
  if(idx>=0)saved[idx]=copy;else saved.unshift(copy);
  saveUserRelics(saved);
}
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
  '青铜器':['bronze-bashuwangziqingtongyue.jpg','bronze-changqiaogaolengtongmao.jpg','bronze-huniuchunyu-3gmuseum.jpg','bronze-huwenshouxinwentongge.jpg','bronze-huwentongge.jpg','bronze-huyouniyu.jpg','bronze-renmianyunleiwentongmao.jpg','bronze-tangyinlinhanxizaiyejintujuan.jpg','bronze-tongbianzhong.jpg','bronze-tongchuheng.jpg','bronze-tongjing-ming.jpg','bronze-tongjing-tang.jpg','bronze-yanchanghuaxiangzhuan.jpg','bronze-yinbanshouxinwentongmao.jpg','bronze-zhanguoniaoxingtongzun.jpg','bronze-bashuhuwentongge-2.jpg','bronze-changqiaogaolengtongmao-2.jpg','bronze-yinbanshouxinwentongmao-2.jpg','bronze-renmianyunleiwentongmao-2.jpg','bronze-bashuwangziqingtongyue-2.jpg','bronze-bashuqiujinhuwentongjian.jpg','bronze-bashushoumianwentongkui.jpg','bronze-sanyangtongzun.jpg','bronze-bashuhuwenqingtongge-3.jpg','bronze-shoumianwenliuyexingbashutongjian.jpg','bronze-bashuniaowentongge.jpg','bronze-zenghouyizhong.jpg','bronze-niaoxingtongzun-fuling.jpg','bronze-huniuchunyu-baren.jpg','bronze-yanxingzun-wushan.jpg','bronze-bashujinyincuoxiniutongdaigou.jpg','bronze-shoumianmingwentongjing.jpg','bronze-yumatongyong.jpg','bronze-yanchanghuaxiangzhuan-2.jpg','bronze-juanyunwendagaiguiltongsi-fuling.jpg','bronze-liujinshuangququetongguanshi.jpg','bronze-tonghuang-baxian.jpg'],
  '石质':['stone-dazushikediaoke.jpg','stone-dazushikefotou.jpg','stone-jiajingzhudiaorenwuchuan.jpg','stone-xuangongzhibei.jpg','stone-yadiaobaxian.jpg','stone-zajingyuanhuace.jpg','stone-xuangongzhibei-2.jpg'],
  '金质':['gold-bashubaiwentongfangyinzhang.jpg','gold-hanguiyiconghoujinyin.jpg','gold-jindaiju.jpg','gold-jinpijiangjunyinzhang.jpg','gold-longshouhuangxingliujintongpaishi.jpg','gold-pijiangjunjinyin.jpg','gold-jindaiju-2.jpg'],
  '陶瓷':['ceramic-changkouheitaohu.jpg','ceramic-cizhouyao-baoyouhecaiguolangciguan.jpg','ceramic-heitaoguan-daxi.jpg','ceramic-hongtaochimaodunyong.jpg','ceramic-liulichuanshi.jpg','ceramic-liulizhu.jpg','ceramic-luyouciguan.jpg','ceramic-qingyoulianbanwenciwan.jpg','ceramic-qingyoushuangxiciguan.jpg','ceramic-taoqi-zhanshi.jpg','ceramic-tushanyao-heicipanguan.jpg','ceramic-tutaocizhenlie.jpg','ceramic-xinshiqishiqihongtaoqi.jpg','ceramic-qianmatong-han.jpg','ceramic-hechaozongzhiguanyinxiang.jpg','ceramic-hongtaojigushuochangyong-han.jpg','other-songshijianyiqin.jpg','other-songshijianyiqin-2.jpg','other-xianshanlougetutushanmian.jpg','other-tangyinlinhanxizaiyejintujuan-2.jpg','other-qibaishisisjishanshuiping.jpg','other-wengonghuichenglishideqianmingzhou.jpg','other-jiangzhuyunlieshideyishu.jpg']
};
var _allRelicImgs=[];
Object.keys(_relicImgs).forEach(function(t){_relicImgs[t].forEach(function(f){_allRelicImgs.push('img/relics/'+f);});});
function relicImg(type,seed){
  var pool=_relicImgs[type]||_relicImgs['青铜器'];
  return 'img/relics/'+pool[Math.abs(seed)%pool.length];
}

// Seeded pseudo-random for deterministic data
function srand(seed){
  var x=Math.sin(seed)*10000;
  return x-Math.floor(x);
}

// 6 new 3D model relics - all restored, Southwest China sites
var newRelics3D=[
  {id:'BYQ-2026-00001',type:'陶瓷',lib:'巴渝陶瓷器专题',site:'重庆巫山',era:'金代',disease:'釉面磨损、口沿小豁',name:'代号00001',imgBefore:'img/relics/relic3d_12.jpg',imgAfter:'img/relics/relic3d_12.jpg',glbRestored:'img/3d/relic3d_12_web.glb',glbUnrestored:'',uploader:'陈涛',restorer:'张伟',status:'已修复',progress:100},
  {id:'BYQ-2026-00002',type:'陶瓷',lib:'巴渝陶瓷器专题',site:'四川广汉',era:'元代',disease:'冲线、足部修复痕',name:'代号00002',imgBefore:'img/relics/relic3d_22.jpg',imgAfter:'img/relics/relic3d_22.jpg',glbRestored:'img/3d/relic3d_22_web.glb',glbUnrestored:'',uploader:'李强',restorer:'王勇',status:'已修复',progress:100},
  {id:'BYQ-2026-00003',type:'青铜器',lib:'巴渝青铜器专题',site:'重庆巴南',era:'战国',disease:'锈蚀、局部变形',name:'代号00003',imgBefore:'img/relics/relic3d_32.jpg',imgAfter:'img/relics/relic3d_32.jpg',glbRestored:'img/3d/relic3d_32_web.glb',glbUnrestored:'',uploader:'刘杰',restorer:'陈涛',status:'已修复',progress:100},
  {id:'BYQ-2026-00004',type:'石质',lib:'大足石刻专题',site:'重庆大足',era:'宋代',disease:'风化、裂纹',name:'代号00004',imgBefore:'img/relics/relic3d_42.jpg',imgAfter:'img/relics/relic3d_42.jpg',glbRestored:'img/3d/relic3d_42_web.glb',glbUnrestored:'',uploader:'杨磊',restorer:'黄斌',status:'已修复',progress:100},
  {id:'BYQ-2026-00005',type:'金质',lib:'涪陵小田溪专题',site:'重庆涪陵',era:'汉代',disease:'沁色、边缘磨损',name:'代号00005',imgBefore:'img/relics/relic3d_52.jpg',imgAfter:'img/relics/relic3d_52.jpg',glbRestored:'img/3d/relic3d_52_web.glb',glbUnrestored:'',uploader:'周超',restorer:'吴明',status:'已修复',progress:100},
  {id:'BYQ-2026-00006',type:'青铜器',lib:'巴渝青铜器专题',site:'四川广汉',era:'商代',disease:'锈蚀严重、腹部缺损',name:'代号00006',imgBefore:'img/relics/relic3d_62.jpg',imgAfter:'img/relics/relic3d_62.jpg',glbRestored:'img/3d/relic3d_62_web.glb',glbUnrestored:'',uploader:'徐辉',restorer:'孙鹏',status:'已修复',progress:100}
];

function genRelics(){
  // Southwest China sites (重庆/四川/贵州/云南/西藏)
  var sites=['重庆涪陵小田溪','重庆万州甘宁乡','重庆巫山','重庆忠县','重庆云阳','重庆奉节','重庆开县','重庆江北区','重庆南川','重庆巴南','重庆大足','重庆合川','重庆永川','重庆长寿','重庆綦江','重庆铜梁','重庆潼南','重庆璧山','重庆大渡口','重庆渝北','四川广汉三星堆','四川成都金沙','四川绵阳','四川广元','四川南充','四川宜宾','四川泸州','四川乐山','四川自贡','四川内江','四川德阳','四川遂宁','四川达州','四川雅安','四川巴中','四川资阳','贵州贵阳','贵州遵义','贵州毕节','贵州铜仁','贵州安顺','云南昆明','云南大理','云南丽江','云南曲靖','云南玉溪','云南楚雄','云南红河','西藏拉萨','西藏日喀则','西藏山南','西藏林芝'];
  var types=['青铜器','石质','金质','陶瓷'];
  var diseases=['表面锈蚀、局部断裂','变形、缺失、锈蚀','断裂、风化','锈蚀严重','裂纹、磨损','碎裂、缺损','金箔脱落、铜锈','风化、面部缺损','焊接点开裂','边角缺损'];
  var eras=['商代','战国','西汉','东汉','南北朝','隋','唐','北宋','南宋','元','明','清','民国'];
  var uploaders=['张伟','李强','王勇','刘杰','陈涛','杨磊','黄斌','周超','吴明','徐辉','孙鹏','马飞','朱军','胡亮','郭建','何斌','高辉','林海','罗勇','郑刚','梁宇','谢斌','宋伟','唐勇','许磊','韩飞','冯刚','邓超','曹伟','彭勇','曾磊','肖斌','田辉','董勇','袁伟','潘飞','于军','蒋涛','蔡勇','余辉','杜斌','叶磊','程勇','苏伟','魏刚','吕军','丁勇','任辉','沈斌','姚伟','卢勇','姜磊','崔勇','钟斌','谭辉','陆伟','汪勇','范斌','金磊','石勇','廖辉','贾伟','夏勇','韦斌','方磊','白勇','邹辉','孟军','熊伟','秦勇','邱斌','江辉','尹磊','薛勇','闫伟','段斌','雷勇','侯辉','龙伟','史勇','陶斌','黎辉','贺勇','顾伟','毛斌','郝勇','龚辉','邵伟','万勇','钱斌','严辉','覃勇','武斌','戴伟','莫勇','孔斌','向辉','汤勇','田野','考古','发掘','保管','文博','志远','建国','建华','国庆','铭辉','文斌','晓东','明辉','国强','学军','建军','丽华','秀英','芳芳','小燕'];
  var restorers=['刘修复','赵匠师','张修复','李匠师','王青铜','陈石质','刘陶瓷','赵金工','孙铭辉','周建国','吴志远','徐文斌','杨建华','黄国庆','张伟','李强','王勇','刘杰','陈涛','杨磊','黄斌','周超','吴明','徐辉','孙鹏','马飞','朱军','胡亮','郭建','何斌','高辉','林海','罗勇','郑刚','梁宇','谢斌','宋伟','唐勇','许磊','韩飞','冯刚','邓超','曹伟','彭勇','曾磊','肖斌','田辉','董勇','袁伟','潘飞','于军','蒋涛','蔡勇','余辉','杜斌','叶磊','程勇','苏伟','魏刚','吕军','丁勇','任辉','沈斌','姚伟','卢勇','姜磊','崔勇','钟斌','谭辉','陆伟','汪勇','范斌','金磊','石勇','廖辉','贾伟','夏勇','韦斌','方磊','白勇','邹辉','孟军','熊伟','秦勇','邱斌','江辉','尹磊','薛勇','闫伟','段斌','雷勇','侯辉','龙伟','史勇','陶斌','黎辉','贺勇','顾伟','毛斌','郝勇','龚辉','邵伟','万勇','钱斌','严辉','覃勇','武斌','戴伟','莫勇','孔斌','向辉','汤勇','晓东','明辉','国强','学军','建军','丽华','秀英','芳芳','小燕'];
  // Southwest China thematic libraries
  var libNames=['巴渝青铜器专题','巴渝陶瓷器专题','大足石刻专题','涪陵小田溪专题','万州考古专题','奉节三峡专题','巫山出土专题','忠县考古专题','三星堆青铜专题','金沙遗址专题','成都平原考古专题','贵州夜郎文化专题','云南古滇国专题','西藏吐蕃文物专题','川南崖墓专题','嘉陵江流域专题','重庆古城遗址专题','四川宋代墓葬专题','乌江流域专题','岷江流域专题'];
  var prefixes=['BYQ','BYC','DZS','FLX','WZK','FJS','WSC','ZXK','SXH','JSY','CDP','GZY','YND','XZT','CNY','JLJ','COC','SCM','WJL','MJL'];
  var libCounts=[1153,847,1092,901,1176,838,1068,854,1129,933,1047,962,891,778,1055,823,974,689,812,756];
  var all=[];

  for(var libIdx=0;libIdx<libNames.length;libIdx++){
    var prefix=prefixes[libIdx];
    var libName=libNames[libIdx];
    var count=libCounts[libIdx];
    for(var j=11;j<=count+10;j++){
      var globalIdx=libIdx*10000+j;
      var seq=String(j).padStart(5,'0');
      var rv=srand(globalIdx);
      // Realistic distribution: 8% 待上传, 12% 已上传, 15% 待修复, 45% 修复中, 20% 已修复
      var status;
      if(rv<0.08)status='待上传';
      else if(rv<0.20)status='已上传';
      else if(rv<0.35)status='待修复';
      else if(rv<0.80)status='修复中';
      else status='已修复';

      var progress=0;
      if(status==='已修复')progress=100;
      else if(status==='修复中')progress=Math.floor(srand(globalIdx+1)*80)+10;
      else if(status==='待修复')progress=0;

      var restorer='';
      if(status==='修复中'||status==='已修复'){
        restorer=restorers[Math.floor(srand(globalIdx+2)*restorers.length)];
      }

      var typeIdx=Math.floor(srand(globalIdx+3)*types.length);
      var siteIdx=Math.floor(srand(globalIdx+4)*sites.length);
      var eraIdx=Math.floor(srand(globalIdx+5)*eras.length);
      var diseaseIdx=Math.floor(srand(globalIdx+6)*diseases.length);
      var uploaderIdx=Math.floor(srand(globalIdx+7)*uploaders.length);

      var imgBeforeUrl=relicImg(types[typeIdx],globalIdx);

      var day=String(Math.floor(srand(globalIdx+8)*28)+1).padStart(2,'0');
      var hr=String(Math.floor(srand(globalIdx+9)*12)+8).padStart(2,'0');
      var min=String(Math.floor(srand(globalIdx+10)*60)).padStart(2,'0');
      var uploadTime='2026-08-'+day+' '+hr+':'+min;

      var deadline='';
      if(status==='修复中'||status==='已修复'){
        var dDay=String(Math.floor(srand(globalIdx+11)*28)+1).padStart(2,'0');
        deadline='2026-10-'+dDay;
      }

      var lastUpdate='';
      if(status==='修复中'){
        var uDay=String(Math.floor(srand(globalIdx+12)*4)+20).padStart(2,'0');
        lastUpdate='2026-08-'+uDay+' '+hr+':00';
      }

      all.push({
        id:prefix+'-2026-'+seq,
        name:'代号'+seq,
        type:types[typeIdx],
        imgBefore:imgBeforeUrl,
        imgDuring:'',
        imgAfter:'',
        library:libName,
        site:sites[siteIdx],
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
  // Assign unique images to the first 50 relics
  for(var i=0;i<50&&i<all.length;i++){
    all[i].imgBefore=_allRelicImgs[i%_allRelicImgs.length];
  }
  // Add 3D model relics at the very beginning
  for(var k=newRelics3D.length-1;k>=0;k--){
    var nr=newRelics3D[k];
    nr.library=nr.lib;nr.size='待测量';nr.weight='待称重';
    nr.uploadedBy=nr.uploader;
    nr.uploadTime='2026-08-25 '+(10+k)+':'+(30+k*7<10?'0'+(30+k*7):30+k*7);
    nr.deadline='2026-10-15';
    nr.lastUpdate='2026-08-25 14:00';
    nr.has3D=true;
    nr.glbRestoredName=nr.glbRestored?nr.glbRestored.split('/').pop():'';
    nr.glbUnrestoredName=nr.glbUnrestored?nr.glbUnrestored.split('/').pop():'';
    all.unshift(nr);
  }
  return all;
}

function genUsers(){
  var surnames=['张','李','王','刘','陈','杨','黄','周','吴','徐','孙','马','朱','胡','郭','何','高','林','罗','郑','梁','谢','宋','唐','许','韩','冯','邓','曹','彭','曾','肖','田','董','袁','潘','于','蒋','蔡','余','杜','叶','程','苏','魏','吕','丁','任','沈','姚','卢','姜','崔','钟','谭','陆','汪','范','金','石','廖','贾','夏','韦','方','白','邹','孟','熊','秦','邱','江','尹','薛','闫','段','雷','侯','龙','史','陶','黎','贺','顾','毛','郝','龚','邵','万','钱','严','覃','武','戴','莫','孔','向','汤'];
  var givens=['伟','强','磊','军','勇','杰','涛','超','明','亮','平','刚','建','华','国','志','文','辉','斌','波','旭','鹏','飞','林','海','宇','豪','龙','凯','鑫','慧','敏','静','燕','丽','娟','芳','婷','娜','倩','雪','莹','玲','君','蕊','蕾','丹','晨','颖'];
  var roleMap=[{role:'系统管理员',dept:'信息中心',scope:'全部文物',count:2},{role:'修复委员会主任',dept:'修复委员会',scope:'全部文物',count:3},{role:'修复师',dept:'修复部-青铜组',scope:'指定专题库',count:15},{role:'修复师',dept:'修复部-石质组',scope:'指定专题库',count:15},{role:'修复师',dept:'修复部-陶瓷组',scope:'指定专题库',count:10},{role:'保管员',dept:'保管部-库房A',scope:'指定库房',count:15},{role:'保管员',dept:'保管部-库房B',scope:'指定库房',count:15},{role:'研究人员',dept:'研究部',scope:'仅查看已修复',count:25}];
  var users=[];var idx=0;
  for(var ri=0;ri<roleMap.length;ri++){
    var rm=roleMap[ri];
    for(var i=0;i<rm.count;i++){
      var name=surnames[idx%100]+givens[idx%48];
      users.push({id:'U'+String(idx+1).padStart(3,'0'),name:name,workId:'CQ-'+String(idx+1).padStart(3,'0'),nickname:name,roleId:rm.role,roleName:rm.role,department:rm.dept,phone:'138000'+String(idx+1).padStart(5,'0'),status:'正常',lastLogin:idx<6?'2026-08-25 0'+(idx+2)+':00':'2026-08-2'+(idx%3)+' '+String((idx%12)+8).padStart(2,'0')+':00',scope:rm.scope,perms:{view:true,edit:rm.role.indexOf('修复')>=0||rm.role==='系统管理员',delete:rm.role==='系统管理员',audit:rm.role.indexOf('管理')>=0||rm.role.indexOf('主任')>=0,assign:rm.role.indexOf('管理')>=0||rm.role.indexOf('主任')>=0}});
      idx++;
    }
  }
  return users;
}

createApp({setup(){
  var loggedIn=ref(false);var authMode=ref('login');
  var loginForm=reactive({username:'',password:''});var loginErr=ref('');
  var regForm=reactive({name:'',workId:'',phone:'',email:'',department:'',roleId:''});var regErr=ref('');
  var regRoles=[{id:'restorer',name:'修复师'},{id:'curator',name:'保管员'},{id:'researcher',name:'研究人员'}];
  onMounted(function(){resolveAllIdbImgs();});
  var roles=[{id:'admin',name:'系统管理员',permissions:'系统配置、用户管理、权限审核、全量数据',dataScope:'全量数据',userCount:2},{id:'director',name:'修复委员会主任',permissions:'修复审批、方案终审、验收确认',dataScope:'全量修复项目',userCount:3},{id:'restorer',name:'修复师',permissions:'修复方案编制、修复日志记录、影像上传',dataScope:'本人参与项目',userCount:40},{id:'curator',name:'保管员',permissions:'出入库操作、库房盘点、环境监测',dataScope:'所属库房',userCount:30},{id:'researcher',name:'研究人员',permissions:'文物查询、修复档案检索（只读）',dataScope:'已归档数据',userCount:25}];
  var currentUser=reactive({name:'',nickname:'',role:'',roleName:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});

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
  // Filter relics based on user role data scope
  var scopedRelics=computed(function(){
    if(!currentUser.perms)return relics.value;
    var scope=currentUser.perms.dataScope;
    if(scope==='all'||scope==='readonly')return relics.value;
    if(scope==='assigned'){
      // For restorers, show only relics they're assigned to; for curators, show their library
      if(currentUser.roleName==='修复师')return relics.value.filter(function(r){return r.restorer===currentUser.name||!r.restorer;});
      return relics.value;
    }
    return relics.value;
  });

  function doLogin(){
    loginErr.value='';
    if(!loginForm.username||!loginForm.password){loginErr.value='请输入账号和密码';return;}
    var u=allUsers.value.find(function(x){return x.workId===loginForm.username||x.phone===loginForm.username;});
    if(!u){loginErr.value='账号不存在，请检查工号或手机号';return;}
    if(u.status!=='正常'){loginErr.value='账号已被禁用，请联系管理员';return;}
    currentUser.name=u.name;currentUser.nickname=u.name;currentUser.role=u.roleId;currentUser.roleName=u.roleName;
    currentUser.perms=rolePerms[u.roleName]||rolePerms['研究人员'];
    u.lastLogin=new Date().toLocaleString('zh-CN');
    loggedIn.value=true;
    nextTick(function(){setTimeout(function(){initCharts();},600);});
  }
  function doRegister(){
    regErr.value='';
    if(!regForm.name){regErr.value='请输入姓名';return;}
    if(!regForm.workId){regErr.value='请输入工号';return;}
    if(!regForm.phone){regErr.value='请输入手机号';return;}
    if(!regForm.roleId){regErr.value='请选择身份';return;}
    var role=regRoles.find(function(r){return r.id===regForm.roleId;});
    pendingUsers.value.push({id:'U'+Date.now(),name:regForm.name,workId:regForm.workId,phone:regForm.phone,email:regForm.email,department:regForm.department,roleId:regForm.roleId,roleName:role?role.name:'',regTime:new Date().toLocaleString('zh-CN'),status:'待审核',scope:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});
    alert('注册申请已提交，请等待管理员审核通过后即可登录。');
    authMode.value='login';regForm.name='';regForm.workId='';regForm.phone='';regForm.email='';regForm.department='';regForm.roleId='';
  }
  function logout(){loggedIn.value=false;loginForm.username='';loginForm.password='';loginErr.value='';}

  var page=ref('dashboard');
  var pageTitle=computed(function(){return{dashboard:'总览面板',thematic:'专题库管理',relics:'文物列表',detail:'文物详情',assignment:'修复任务分配',monitor:'修复进度监控',traceability:'责任链追溯',statistics:'统计分析',accounts:'用户与权限',aiRepair:'AI智能修复分析'}[page.value]||'';});
  function nav(p){page.value=p;}

  var types=['青铜器','石质','金质','陶瓷'];
  var libCounts=[1153,847,1092,901,1176,838,1068,854,1129,933,1047,962];
  var libStatuses=['采集中','采集中','修复中','采集中','采集中','修复中','采集中','采集中','采集中','修复中','采集中','采集中'];
  var libs=ref([
    {id:'TL01',name:'巴渝青铜器专题',prefix:'BYQ',desc:'重庆地区出土巴蜀青铜器修复管理',count:libCounts[0],status:libStatuses[0]},
    {id:'TL02',name:'三峡出土文物专题',prefix:'SXG',desc:'三峡库区出土文物数字化采集与修复',count:libCounts[1],status:libStatuses[1]},
    {id:'TL03',name:'大足石刻专题',prefix:'DZS',desc:'大足石刻保护与修复项目',count:libCounts[2],status:libStatuses[2]},
    {id:'TL04',name:'涪陵小田溪专题',prefix:'FLX',desc:'涪陵小田溪巴人墓地出土文物',count:libCounts[3],status:libStatuses[3]},
    {id:'TL05',name:'万州考古专题',prefix:'WZK',desc:'万州地区考古出土文物修复',count:libCounts[4],status:libStatuses[4]},
    {id:'TL06',name:'奉节三峡专题',prefix:'FJS',desc:'奉节三峡库区文物抢救性保护',count:libCounts[5],status:libStatuses[5]},
    {id:'TL07',name:'巫山出土专题',prefix:'WSC',desc:'巫山遗址出土文物数字化',count:libCounts[6],status:libStatuses[6]},
    {id:'TL08',name:'忠县考古专题',prefix:'ZXK',desc:'忠县乌杨等遗址文物修复',count:libCounts[7],status:libStatuses[7]},
    {id:'TL09',name:'云阳遗址专题',prefix:'YYS',desc:'云阳旧县坪等遗址出土文物',count:libCounts[8],status:libStatuses[8]},
    {id:'TL10',name:'开县文物专题',prefix:'KXW',desc:'开县出土文物修复管理',count:libCounts[9],status:libStatuses[9]},
    {id:'TL11',name:'南川墓葬专题',prefix:'NCM',desc:'南川南宋石室墓出土文物',count:libCounts[10],status:libStatuses[10]},
    {id:'TL12',name:'合川出土专题',prefix:'HCW',desc:'合川区考古出土文物修复',count:libCounts[11],status:libStatuses[11]},
  ]);
  var _generatedRelics=genRelics();
  var _userRelics=loadUserRelics();
  var relics=ref(_userRelics.concat(_generatedRelics));
  var resolvedImgs=reactive({});
  function resolveAllIdbImgs(){
    relics.value.forEach(function(r){
      if(r.imgBefore&&r.imgBefore.indexOf('idb://')===0){
        resolveIdbUrl(r.imgBefore).then(function(url){
          if(url)resolvedImgs[r.id]=url;
        });
      }
    });
  }
  var allUsers=ref(genUsers());

  var fStatus=ref('全部');var fType=ref('');var fLib=ref('');var search=ref('');
  var filteredRelics=computed(function(){return relics.value.filter(function(r){
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

  function sc(s){return relics.value.filter(function(r){return r.status===s;}).length;}
  function sb(s){return{'待上传':'b-s1','已上传':'b-s2','待修复':'b-s3','修复中':'b-s4','已修复':'b-s5'}[s]||'';}
  var repairingCount=computed(function(){return relics.value.filter(function(r){return r.status==='修复中';}).length;});
  var pendingCount=computed(function(){return relics.value.filter(function(r){return r.status==='已上传';}).length;});

  var showNoti=ref(false);
  var notifications=ref([
    {id:1,text:'BYQ-2026-00832 修复进度更新为65%',time:'2小时前'},
    {id:2,text:'SXG-2026-00471 等待分配修复师',time:'1天前'},
    {id:3,text:'DZS-2026-01023 修复完成，已归档',time:'3天前'}
  ]);
  var pendingItems=computed(function(){
    var items=[];
    var up=relics.value.filter(function(r){return r.status==='已上传';});
    if(up.length>0)items.push({id:'p1',level:'warn',icon:'!',text:up.length+' 件文物等待分配修复师',btnType:'outline',btnText:'去分配',action:function(){nav('assignment');}});
    relics.value.filter(function(r){return r.status==='修复中'&&r.progress<30;}).slice(0,3).forEach(function(r){items.push({id:'p'+r.id,level:'no',icon:'!',text:r.id+' 修复进度偏低 ('+r.progress+'%)',btnType:'outline',btnText:'查看',action:function(){viewRelic(r);}});});
    if(pendingUsers.value.length>0)items.push({id:'pu',level:'info',icon:'i',text:pendingUsers.value.length+' 个用户待审核',btnType:'outline',btnText:'去审核',action:function(){nav('accounts');}});
    return items;
  });

  var sel=ref(null);var dTab=ref('timeline');
  var selTimeline=computed(function(){if(!sel.value)return[];return[
    {id:1,time:sel.value.uploadTime,cls:'done',title:'文物上传',desc:'移动端扫描上传完成',person:sel.value.uploadedBy},
    {id:2,time:sel.value.uploadTime,cls:'done',title:'数据审核',desc:'Web端审核通过',person:'管理员'},
  ].concat(sel.value.restorer?[{id:3,time:'',cls:'',title:'修复分配',desc:'分配给 '+sel.value.restorer,person:'管理人员'}]:[])
    .concat(sel.value.status==='修复中'||sel.value.status==='已修复'?[{id:4,time:sel.value.lastUpdate,cls:'warn',title:'修复进行中',desc:'当前进度 '+sel.value.progress+'%',person:sel.value.restorer}]:[])
    .concat(sel.value.status==='已修复'?[{id:5,time:'',cls:'done',title:'修复完成',desc:'验收通过，已归档',person:'验收组'}]:[]);});
  var selChain=computed(function(){if(!sel.value)return[];return[
    {step:'1 建立专题库',time:sel.value.uploadTime.split(' ')[0],desc:'创建'+sel.value.library,person:'项目负责人',role:'项目负责人',terminal:'Web端'},
    {step:'2 扫描上传',time:sel.value.uploadTime,desc:'移动端扫描上传',person:sel.value.uploadedBy,role:'现场工作人员',terminal:'移动端'},
    {step:'3 数据审核',time:sel.value.uploadTime,desc:'审核通过',person:'管理员',role:'Web端管理员',terminal:'Web端'},
  ].concat(sel.value.restorer?[{step:'4 修复分配',time:'',desc:'分配给修复师',person:'管理人员',role:'修复部门负责人',terminal:'Web端'}]:[])
    .concat(sel.value.status==='修复中'||sel.value.status==='已修复'?[{step:'5 修复执行',time:sel.value.lastUpdate,desc:'进度'+sel.value.progress+'%',person:sel.value.restorer,role:'修复师',terminal:'移动端'}]:[])
    .concat(sel.value.status==='已修复'?[{step:'6 验收确认',time:'',desc:'验收通过',person:'验收组',role:'修复委员会',terminal:'Web端'},{step:'7 归档跟踪',time:'',desc:'修复档案归档',person:'档案管理员',role:'档案管理员',terminal:'Web端'}]:[]);});
  var repairLogs=ref([{id:1,date:'2026-08-21',content:'表面清洗，去除浮锈',materials:'EDTA溶液、脱离子水',hours:4,restorer:'刘修复'},{id:2,date:'2026-08-22',content:'断裂部位粘接',materials:'Paraloid B-72',hours:6,restorer:'刘修复'},{id:3,date:'2026-08-23',content:'补全处理，做色',materials:'矿物颜料、丙烯酸树脂',hours:5,restorer:'刘修复'}]);
  function viewRelic(r){sel.value=r;dTab.value='timeline';nav('detail');}

  var showLibModal=ref(false);var newLib=reactive({name:'',prefix:'',desc:''});
  function createLib(){if(!newLib.name||!newLib.prefix){alert('请填写名称和前缀');return;}
    libs.value.push({id:'TL'+String(libs.value.length+1).padStart(2,'0'),name:newLib.name,prefix:newLib.prefix,desc:newLib.desc,count:0,status:'采集中'});
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
    var newRelic={id:newId,name:upForm.name||('代号'+seq),type:upForm.type,imgBefore:hasImg?'idb://imgFiles/'+newId:relicImg(upForm.type,libCount),imgDuring:'',imgAfter:'',library:upForm.library,site:upForm.site||'待补充',era:upForm.era||'待确认',size:upForm.size||('高'+(Math.floor(Math.random()*30)+15)+'cm'),weight:upForm.weight||((Math.random()*2+0.3).toFixed(2)+'kg'),uploadedBy:currentUser.name,uploadTime:new Date().toLocaleString('zh-CN'),status:'已上传',restorer:'',progress:0,deadline:'',lastUpdate:'',disease:upForm.disease||'待记录',has3D:hasGlb,glbRestored:'',glbUnrestored:hasGlb?'idb://glbFiles/'+newId+'_unrestored':'',glbRestoredName:'',glbUnrestoredName:hasGlb?upForm.glbName:'',userUploaded:true};
    if(hasGlb){idbSave('glbFiles',newId+'_unrestored',_pendingGlbBlob);}
    if(hasImg){idbSave('imgFiles',newId,_pendingImgBlob);}
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
    updateUserRelicInStorage(r);
    showAssignModal.value=false;
    alert('\u5df2\u5c06\u7f16\u53f7 '+r.id+' \u5206\u914d\u7ed9\u4fee\u590d\u5e08 '+assignForm.restorer);
  }

  var traceSearch=ref('');var traceResult=ref(null);
  function doTrace(){
    if(!traceSearch.value){alert('请输入文物编号');return;}
    var r=relics.value.find(function(x){return x.id===traceSearch.value;});
    if(!r){traceResult.value=null;alert('未找到匹配的文物');return;}
    traceResult.value={id:r.id,chain:[
      {step:'1 建立专题库',time:r.uploadTime.split(' ')[0],desc:'创建'+r.library,person:'项目负责人',role:'项目负责人',terminal:'Web端'},
      {step:'2 扫描上传',time:r.uploadTime,desc:'移动端扫描上传',person:r.uploadedBy,role:'现场工作人员',terminal:'移动端'},
      {step:'3 数据审核',time:r.uploadTime,desc:'审核通过',person:'管理员',role:'Web端管理员',terminal:'Web端'},
    ].concat(r.restorer?[{step:'4 修复分配',time:'',desc:'分配给修复师',person:'管理人员',role:'修复部门负责人',terminal:'Web端'}]:[])
    .concat(r.status==='修复中'||r.status==='已修复'?[{step:'5 修复执行',time:r.lastUpdate,desc:'进度'+r.progress+'%',person:r.restorer,role:'修复师',terminal:'移动端'}]:[])
    .concat(r.status==='已修复'?[{step:'6 验收确认',time:'',desc:'验收通过',person:'验收组',role:'修复委员会',terminal:'Web端'},{step:'7 归档跟踪',time:'',desc:'修复档案归档',person:'档案管理员',role:'档案管理员',terminal:'Web端'}]:[])};
  }

  var monSearch=ref('');var monStage=ref('');
  function stageLabel(p){if(p<30)return '初期清洗';if(p<70)return '中期修复';return '后期收尾';}
  var filteredMonitor=computed(function(){return relics.value.filter(function(r){
    if(r.status!=='修复中')return false;
    if(monSearch.value){var s=monSearch.value;if(r.id.indexOf(s)<0&&r.restorer.indexOf(s)<0)return false;}
    if(monStage.value==='初期'&&r.progress>=30)return false;
    if(monStage.value==='中期'&&(r.progress<30||r.progress>=70))return false;
    if(monStage.value==='后期'&&r.progress<70)return false;
    return true;
  });});

  var pendingUsers=ref([{id:'U101',name:'王新员',workId:'CQ-101',phone:'13800000101',email:'wang@example.com',department:'修复部',roleId:'restorer',roleName:'修复师',regTime:'2026-08-23 09:30',status:'待审核',scope:'',perms:{view:true,edit:false,delete:false,audit:false,assign:false}}]);
  var activeUsers=computed(function(){return allUsers.value.filter(function(u){return u.status!=='待审核';});});
  var userSearch=ref('');
  var filteredUsers=computed(function(){return activeUsers.value.filter(function(u){if(!userSearch.value)return true;return u.name.indexOf(userSearch.value)>=0||u.workId.indexOf(userSearch.value)>=0||u.department.indexOf(userSearch.value)>=0;}).slice(0,50);});
  var showUserModal=ref(false);var newUser=reactive({name:'',workId:'',roleId:'restorer',department:'',phone:''});
  function createUser(){if(!newUser.name||!newUser.workId){alert('请填写姓名和工号');return;}
    var role=roles.find(function(r){return r.id===newUser.roleId;});
    allUsers.value.push({id:'U'+Date.now(),name:newUser.name,workId:newUser.workId,nickname:newUser.name,roleId:newUser.roleId,roleName:role?role.name:'',department:newUser.department||'待分配',phone:newUser.phone||'未填写',status:'正常',lastLogin:'未登录',scope:'全部文物',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});
    showUserModal.value=false;newUser.name='';newUser.workId='';newUser.department='';newUser.phone='';
  }
  function toggleStatus(u){u.status=u.status==='正常'?'禁用':'正常';}

  var showAuditModal=ref(false);var auditTarget=ref(null);
  var permList=[{key:'view',label:'查看文物数据'},{key:'edit',label:'编辑文物信息'},{key:'delete',label:'删除文物'},{key:'audit',label:'审核上传数据'},{key:'assign',label:'分配修复任务'}];
  var auditForm=reactive({scope:'全部文物',perms:{view:true,edit:false,delete:false,audit:false,assign:false}});
  function openAudit(u){auditTarget.value=u;auditForm.scope='全部文物';auditForm.perms={view:true,edit:false,delete:false,audit:false,assign:false};showAuditModal.value=true;}
  function approveUser(){var u=auditTarget.value;u.scope=auditForm.scope;u.perms=JSON.parse(JSON.stringify(auditForm.perms));u.status='正常';u.lastLogin='未登录';u.nickname=u.name;allUsers.value.push(u);var idx=pendingUsers.value.findIndex(function(x){return x.id===u.id;});if(idx>-1)pendingUsers.value.splice(idx,1);showAuditModal.value=false;alert('用户「'+u.name+'」审核通过');}
  function rejectUser(u){var idx=pendingUsers.value.findIndex(function(x){return x.id===u.id;});if(idx>-1)pendingUsers.value.splice(idx,1);alert('用户「'+u.name+'」的注册申请已驳回');}
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
          resolveIdbUrl(glbPath).then(function(resolvedUrl){
          if(!resolvedUrl){loading3D.value=false;alert('3D模型文件未找到，可能已被清除');return;}
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
            if(xhr.lengthComputable){var pct=Math.round(xhr.loaded/xhr.total*100);var lp=document.querySelector('#viewer3d-container p');if(lp)lp.textContent='加载3D模型中... '+pct+'%';}
          },function(err){console.error('GLB load error:',err);loading3D.value=false;var lp=document.querySelector('#viewer3d-container p');if(lp)lp.textContent='3D模型加载失败';});
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
    idbSave('glbFiles',idbKey,file).then(function(){
      if(type==='restored'){
        sel.value.glbRestored='idb://glbFiles/'+idbKey;
        sel.value.glbRestoredName=file.name;
        sel.value.has3D=true;
        model3DMode.value='restored';
      }else{
        sel.value.glbUnrestored='idb://glbFiles/'+idbKey;
        sel.value.glbUnrestoredName=file.name;
        sel.value.has3D=true;
      }
      updateUserRelicInStorage(sel.value);
      alert((type==='restored'?'已修复':'待修复')+'3D模型上传成功，正在加载...');
      initViewer3D();
    });
  }

  return{loggedIn,authMode,loginForm,loginErr,doLogin,regForm,regErr,regRoles,doRegister,logout,currentUser,
    page,pageTitle,nav,types,libs,relics,allUsers,
    canManageUsers,canViewStats,canViewAI,canAssign,canEdit,canDelete,canAudit,scopedRelics,
    fStatus,fType,fLib,search,filteredRelics,pageSize,curPage,totalPages,visiblePages,pagedRelics,sc,sb,repairingCount,pendingCount,
    showNoti,notifications,pendingItems,sel,dTab,selTimeline,selChain,repairLogs,viewRelic,
    showLibModal,newLib,createLib,filterByLib,showUploadModal,upForm,doUpload,
    showAssignModal,assignTarget,assignForm,restorers,openAssign,confirmAssign,
    traceSearch,traceResult,doTrace,
    monSearch,monStage,filteredMonitor,stageLabel,
    pendingUsers,activeUsers,userSearch,filteredUsers,showUserModal,newUser,createUser,toggleStatus,
    showAuditModal,auditTarget,permList,auditForm,openAudit,approveUser,rejectUser,rejectFromAudit,
    showPermModal,permTarget,openPermModal,restorerStats,roles,onPageEntered,
    aiSearch,aiRelic,aiAnalyzing,aiResult,aiAnalyze,analyzeRelicAI,
    model3DMode,loading3D,switch3DMode,initViewer3D,onGLBUpload,onRelicGLBUpload,onImgUpload,
    chartStatus,chartTrend,chartWorkload,chartType,chartRepairStatus,chartLib,chartMonthly,
    resolvedImgs};
}}).mount('#app');
