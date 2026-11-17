'use strict';
// 纯函数：真机测试调用前，先由人确认截图；此模块本身不会读取或操作屏幕。
const policy = require('../electron/desk-policy.cjs');
function preflight(probe, displays, screenshotReviewed) {
  if (!screenshotReviewed) throw Error('没有本次截图人工确认，不运行真键鼠');
  if (!probe?.ok || !probe.fg?.hwnd || !Array.isArray(probe.fg.rect)) throw Error('前台窗口信息不完整，不运行');
  if (/游戏|星穹|原神|StarRail|Genshin|UnityWndClass|UnrealWindow/i.test([probe.fg.title,probe.fg.exe,probe.fg.cls].join(' '))) throw Error('前台为游戏，不运行');
  const [l,t,r,b] = probe.fg.rect;
  if (![l,t,r,b].every(Number.isFinite) || r<=l || b<=t) throw Error('前台窗口位置无效，不运行');
  if(displays.some(d=>l<=d.phys.x+2 && t<=d.phys.y+2 && r>=d.phys.x+d.phys.width-2 && b>=d.phys.y+d.phys.height-2)) throw Error('前台覆盖整屏，不运行');
  return true;
}
function targetPoint(rect, displays, shots) {
  const px=Math.round(rect.x+rect.width/2), py=Math.round(rect.y+rect.height/2);
  const p=policy.fromPhysical(displays,d=>shots[d.index]||policy.shotSize(d.phys),px,py);
  if(!p) throw Error('靶子不在已知屏幕上');
  const d=displays.find(d=>d.index===p.index);
  const physical=policy.toPhysical(d.phys,shots[d.index]||policy.shotSize(d.phys),p.x,p.y);
  if(physical.x<rect.x || physical.x>=rect.x+rect.width || physical.y<rect.y || physical.y>=rect.y+rect.height) throw Error('坐标换算后没有落在靶子内');
  return p;
}
function requireTarget(probe, ready, requireFocus=false) {
  if(!probe?.ok || Number(probe.at?.pid)!==ready.pid || Number(probe.at?.hwnd)!==ready.hwnd) throw Error('坐标下不是本次靶子，停止且不点击');
  if(requireFocus && (Number(probe.fg?.pid)!==ready.pid || Number(probe.fg?.hwnd)!==ready.hwnd)) throw Error('焦点不在本次靶子，停止且不输入');
}
module.exports={preflight,targetPoint,requireTarget};
