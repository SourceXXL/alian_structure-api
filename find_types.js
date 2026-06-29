const fs = require('fs');
const path = require('path');
const root = 'C:/Users/User/Desktop/alian_structure-api/node_modules/@nestjs';
let found = [];
function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) {
    if (f.startsWith('.')) continue;
    const fp = path.join(d, f);
    if (fs.statSync(fp).isDirectory()) walk(fp);
    else if (fp.endsWith('.d.ts') || fp.endsWith('.js')) {
      const c = fs.readFileSync(fp, 'utf8');
      if (c.includes('HealthIndicatorStatus')) found.push(fp);
    }
  }
}
walk(root);
console.log(found.join('\n'));
