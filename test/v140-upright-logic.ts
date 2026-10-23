// 1.4.0 照片转正：OCR 四个方向的文字打分，挑出正的方向；看不出来时交给模型
import assert from 'node:assert/strict';
import { pickTurn, uprightScore } from '../src/lib/importLogic';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };

ok('正着的英文、中文得分高，横着倒着认出的乱码几乎不得分', () => {
  const en = uprightScore(['31. What does the underlined word in the passage mean?', 'The team found that the system had to be close to the body']);
  const zh = uprightScore(['阅读下面短文，从每题所给的四个选项中选出最佳选项']);
  const junk = uprightScore(['uǝɐɯ ǝƃɐssɐd', 'l1I| ;:-~ 0O', 'a i a i', '﹁丨亅乚']);
  assert.ok(en >= 16, String(en)); assert.ok(zh >= 10, String(zh)); assert.ok(junk <= 1, String(junk));
});

ok('明显胜出才转；字太少或者两个方向差不多时交给模型', () => {
  assert.equal(pickTurn([2, 40, 3, 1]), 90);
  assert.equal(pickTurn([60, 1, 4, 0]), 0);
  assert.equal(pickTurn([0, 0, 30, 2]), 180);
  assert.equal(pickTurn([4, 6, 2, 1]), null, '字太少');
  assert.equal(pickTurn([30, 25, 1, 1]), null, '两个方向差不多');
  assert.equal(pickTurn([1, 2]), null);
});

console.log(`${n}/2 通过`);
