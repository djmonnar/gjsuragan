'use strict';

// Local-only review server. Uses sample data and the real attendance service with
// Firestore Emulator. It never connects to production Auth or Firestore.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createAttendanceService, createAttendanceHandler } = require('../attendance');
const { workDate } = require('../attendanceModel');
const root = path.resolve(__dirname, '../..');
const projectId = 'demo-gjsuragan-attendance-preview';
const port = Number(process.env.ATTENDANCE_PREVIEW_PORT || 8765);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 before starting the local preview.');
const db = getFirestore(initializeApp({ projectId }, 'attendance-preview'));
let clock = null;
const service = createAttendanceService({ db, now: () => clock ?? Date.now() });
const handler = createAttendanceHandler({ service, verifyToken: async token => {
  if (token !== 'local-emulator-admin') throw new Error('Invalid local fixture token');
  return { uid: 'local-preview-admin', email: 'sun1562@naver.com' };
} });

const firebaseStub = `
(() => {
 const snap = { exists:false, empty:true, size:0, docs:[], data:()=>({}), forEach:()=>{}, docChanges:()=>[] };
 const query = new Proxy({}, {get:(_,k)=>k==='get'?async()=>snap:k==='onSnapshot'?(cb)=>{setTimeout(()=>cb(snap),0);return()=>{}}:()=>query});
 const user = {uid:'local-preview-admin', email:'sun1562@naver.com', getIdToken:async()=> 'local-emulator-admin'};
 const auth = {currentUser:user,setPersistence:async()=>{},onAuthStateChanged:cb=>{setTimeout(()=>cb(user),10);return()=>{}},signInWithEmailAndPassword:async()=>({user}),signOut:async()=>{}};
 const app = {auth:()=>auth,firestore:()=>query,storage:()=>query};
 window.firebase = {initializeApp:()=>app,auth:{Auth:{Persistence:{NONE:'none'}}},messaging:{isSupported:()=>false},firestore:{FieldValue:{serverTimestamp:()=>null,delete:()=>null},Timestamp:{fromDate:d=>d}}};
})();`;

async function start() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  const today = workDate(Date.now());
  const month = today.slice(0, 7);
  const names = ['김수라','이정민','박영희','최민수','정하늘','윤서연','한지우','오현우'];
  const ids = [];
  for (let i = 0; i < names.length; i++) {
    const e = { name:names[i], role:['조리','포장','배송'][i%3],active:true,payType:i===0?'salaried':'hourly',hourlyRate:i===0?0:12000,breakMinutes:0,note:'로컬 미리보기용 가상 직원' };
    const {id} = await service.saveEmployee(e, 'local-preview-admin'); ids.push(id);
    for (let day = 1; day <= Math.min(Number(today.slice(8)) - 1, 8); day++) {
      const checkInAt = new Date(`${month}-${String(day).padStart(2,'0')}T09:00:00+09:00`).getTime();
      await service.saveShift({employeeId:id,checkInAt,checkOutAt:checkInAt+8*3600000,payType:e.payType,hourlyRate:e.hourlyRate,breakMinutes:60,note:''}, 'local-preview-admin');
    }
  }
  const {token} = await service.createDevice({name:'매장 태블릿 · 가상 데이터'}, 'local-preview-admin');
  clock = new Date(`${today}T09:00:00+09:00`).getTime();
  if (clock < Date.now()) {
    for (let i = 0; i < 3; i++) await service.punch({employeeId:ids[i],kind:'in',requestId:`sample-${i}`}, token);
  }
  clock = null;
  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/attendanceApi') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 65536) { res.writeHead(413).end(); return; } }
      try { req.body = body ? JSON.parse(body) : {}; } catch (_) { res.writeHead(400).end(); return; }
      res.set = (key,value) => res.setHeader(key,value);
      res.status = code => {res.statusCode=code;return res;};
      res.json = value => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
      res.send = value => res.end(value);
      await handler(req,res); return;
    }
    if (url.pathname === '/preview-firebase.js') { res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(firebaseStub);return; }
    if (url.pathname === '/sw.js') { res.setHeader('Content-Type','text/javascript');res.end('');return; }
    const pathname = url.pathname === '/' ? '/attendance.html' : url.pathname;
    if (!/^\/(?:admin\.html|attendance\.html|assets\/(?:css|js|img)\/[^?]+|icons\/icon\.svg|admin-manifest\.json)$/.test(pathname)) {res.writeHead(404).end();return;}
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) {res.writeHead(404).end();return;}
    const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'};
    res.setHeader('Content-Type',`${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
    res.setHeader('Cache-Control','no-store');
    if (!['.html','.js','.css'].includes(path.extname(file))) {res.end(fs.readFileSync(file));return;}
    let content = fs.readFileSync(file,'utf8');
    if (pathname.endsWith('.html')) {
      content = content.replace(/<script\b[^>]*src="https:\/\/www\.gstatic\.com\/firebasejs\/[^\"]+"[^>]*><\/script>/g, '');
      content = content.replace('<head>', '<head><script src="/preview-firebase.js"></script>');
      if (pathname === '/attendance.html' && !url.searchParams.has('setup')) content = content.replace('<head>', `<head><script>localStorage.setItem('gjsuragan-attendance-device','${token}');</script>`);
      if (pathname === '/attendance.html' && url.searchParams.has('setup')) content = content.replace('<head>', "<head><script>localStorage.removeItem('gjsuragan-attendance-device');</script>");
    }
    if (pathname.endsWith('/attendance-ui.js')) content = content.replace('https://asia-northeast3-gjsuragan-60505.cloudfunctions.net/attendanceApi', `http://127.0.0.1:${port}/attendanceApi`);
    res.end(content);
  }).listen(port,'127.0.0.1', () => console.log(`Local attendance preview ready at http://127.0.0.1:${port}/attendance.html and /admin.html#attendance (sample data, Firestore Emulator only).`));
}
start().catch(error=>{console.error(error);process.exitCode=1;});
