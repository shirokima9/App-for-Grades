import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import qrcode from 'qrcode-terminal';
import { ROOT } from './db/index.js';
import coreRoutes from './routes/core.js';
import importRoutes from './routes/import.js';
import gradesRoutes from './routes/grades.js';
import submitRoutes from './routes/submit.js';
import analyticsRoutes from './routes/analytics.js';
import reportsRoutes from './routes/reports.js';

const PORT = Number(process.env.PORT || 4750);
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use('/api', coreRoutes);
app.use('/api', gradesRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', reportsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/submit', submitRoutes);

// الواجهة المبنية تُخدَم من نفس الخادم — منفذ واحد، بلا أي مورد خارجي
const DIST = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('الواجهة غير مبنية بعد — شغّل: npm run build:client'));
}

// اكتشاف كل عناوين IPv4 الفعلية (يشمل شبكة نقطة الاتصال من الجوال)
function lanAddresses() {
  const addrs = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push({ name, address: iface.address });
    }
  }
  return addrs;
}

app.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('\n==============================================');
  console.log('  تطبيق إدارة درجات الطلاب — يعمل الآن');
  console.log('==============================================');
  console.log(`\n  من هذا الجهاز:  http://localhost:${PORT}\n`);
  if (addrs.length === 0) {
    console.log('  لا توجد شبكة محلية حاليًا — فعّل نقطة الاتصال من جوالك ثم أعد التشغيل.');
  }
  for (const { name, address } of addrs) {
    const url = `http://${address}:${PORT}`;
    console.log(`  من الجوال (شبكة ${name}):  ${url}`);
    qrcode.generate(url, { small: true }, (qr) => console.log(qr));
  }
  console.log('  امسح رمز QR بكاميرا الجوال لفتح التطبيق.\n');
});
