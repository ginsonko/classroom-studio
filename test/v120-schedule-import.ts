// 1.2.0 课表导入：时间 / 星期 / 日期解析、表格和文字的规则识别、模型结果校验、Excel / Word 读字、预览与合并替换
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  NEW, dateStyleSet, docxText, lessonsByRules, lessonsFromJson, matchStudent, parseDate, parseDay, parseRange, parseTime,
  planImport, rowsOf, schedulePrompt, sharedStrings, sheetText, subjectFor, whenText,
} from '../src/doc/scheduleImport';
import type { LessonSlot, Student } from '../src/lib/types';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log('ok ' + name); };
const today = new Date(2026, 9, 21); // 周三
const S = (id: string, name: string, p: Partial<Student> = {}): Student => ({ id, name, grade: '高二', hue: 190, textbook: '', subject: 'physics', tags: [], lessons: 0, lastTopic: '', lastAt: '', ...p });
const students = [S('a', '俊宇'), S('b', '欣怡'), S('c', '王浩然', { archived: true })];

(async () => {
  await ok('时刻、时间段、星期、日期', () => {
    assert.equal(parseTime('19:30'), 19.5);
    assert.equal(parseTime('晚上7点半'), 19.5);
    assert.equal(parseTime('下午3点一刻'), 15.25);
    assert.equal(parseTime('7:00'), 19, '没写上下午、早于 8 点按晚上');
    assert.equal(parseTime('9:00'), 9);
    assert.equal(parseTime('中午1点'), 13);
    assert.equal(parseTime('7:30pm'), 19.5);
    assert.deepEqual(parseRange('19:00-20:30'), [19, 1.5]);
    assert.deepEqual(parseRange('晚上7点到8点半'), [19, 1.5]);
    assert.deepEqual(parseRange('7:00~8:30'), [19, 1.5]);
    assert.deepEqual(parseRange('11:00-1:00'), [11, 2]);
    assert.deepEqual(parseRange('下午2:00—4:00'), [14, 2]);
    assert.deepEqual(parseRange('2026-10-25 19:00-21:00'), [19, 2], '日期不当成时间段');
    assert.deepEqual(parseRange('14:00 2小时'), [14, 2]);
    assert.equal(parseRange('2026-10-25'), null);
    assert.equal(parseDay('周一'), 0); assert.equal(parseDay('星期日'), 6); assert.equal(parseDay('礼拜天'), 6);
    assert.equal(parseDay('Sat'), 5); assert.equal(parseDay(1), 0); assert.equal(parseDay(7), 6); assert.equal(parseDay('周7'), 6);
    assert.equal(parseDay('张三'), null);
    assert.equal(parseDate('2026年10月25日', today), '2026-10-25');
    assert.equal(parseDate('10/25', today), '2026-10-25');
    assert.equal(parseDate('1月3日', today), '2027-01-03', '没写年份取最近的一年');
    assert.equal(parseDate('2月30日', today), '');
  });

  await ok('规则识别：周课表（周几在表头、时段在第一列，合并单元格展开后连着的合成一节）', () => {
    const text = [
      '时间\t周一\t周二\t周三\t周四\t周五\t周六\t周日',
      '08:00-10:00\t\t\t\t\t\t张俊宇 物理\t',
      '10:00-12:00\t\t\t\t\t\t张俊宇 物理\t欣怡 数学',
      '19:00-20:30\t俊宇 电磁感应\t\t李明（初二数学）\t\t休息\t\t',
    ].join('\n');
    const l = lessonsByRules(text, ['俊宇', '欣怡'], today);
    assert.equal(l.length, 4, JSON.stringify(l));
    const sat = l.find((x) => x.day === 5)!;
    assert.deepEqual([sat.student, sat.start, sat.len, sat.repeat], ['俊宇', 8, 4, true]);
    const mon = l.find((x) => x.day === 0)!;
    assert.deepEqual([mon.student, mon.start, mon.len, mon.topic], ['俊宇', 19, 1.5, '电磁感应']);
    const li = l.find((x) => x.day === 2)!;
    assert.equal(li.student, '李明'); assert.equal(li.subject, '数学');
  });

  await ok('规则识别：一行一节的文字，日期行下面的课跟着那天', () => {
    const l = lessonsByRules('周三 19:00-20:30 俊宇 牛顿第二定律\n10月24日（周六）\n14:00-16:00 欣怡 函数\n每周日 晚上7点到9点 子轩', ['俊宇', '欣怡'], today);
    assert.equal(l.length, 3, JSON.stringify(l));
    assert.deepEqual([l[0].student, l[0].day, l[0].repeat, l[0].topic], ['俊宇', 2, true, '牛顿第二定律']);
    const x = l.find((v) => v.student === '欣怡')!;
    assert.deepEqual([x.date, x.day, x.repeat, x.start], ['2026-10-24', 5, false, 14]);
    const z = l.find((v) => v.student === '子轩')!;
    assert.deepEqual([z.day, z.start, z.len, z.repeat], [6, 19, 2, true]);
  });

  await ok('模型结果逐条校验：缺学生 / 时间的丢掉并计数；结束时间没写下午也能算对', () => {
    const r = lessonsFromJson({ lessons: [
      { student: '俊宇', day: '周一', start: '19:00', end: '8:30', topic: '电磁感应', repeat: true },
      { student: '欣怡', date: '10月24日', start: '14:00', end: '16:00', repeat: false },
      { student: '', day: '周二', start: '19:00', end: '20:00' },
      { student: '子轩', day: '某天', start: '19:00', end: '20:00' },
      'bad',
    ] }, today);
    assert.equal(r.dropped, 3);
    assert.deepEqual([r.lessons[0].start, r.lessons[0].len, r.lessons[0].day], [19, 1.5, 0]);
    assert.deepEqual([r.lessons[1].date, r.lessons[1].day, r.lessons[1].repeat], ['2026-10-24', 5, false]);
    const p = schedulePrompt(today, ['俊宇'], 'x');
    assert.match(p, /2026-10-21（周三）/); assert.match(p, /俊宇/); assert.match(p, /"lessons"/);
  });

  await ok('学生对号：全名 / 包含都算，多个都像时不猜；新学生的学科跟年级和课表里的学科走', () => {
    assert.equal(matchStudent('张俊宇', students)?.id, 'a');
    assert.equal(matchStudent('欣怡同学', students)?.id, 'b');
    assert.equal(matchStudent('浩然', students)?.id, 'c', '只对上一个归档学生时也认');
    assert.equal(matchStudent('李明', students), undefined);
    assert.equal(matchStudent('宇', students), undefined);
    assert.equal(matchStudent('俊宇欣怡', students), undefined, '同时像两个学生不猜');
    assert.equal(subjectFor('初二', '数学', students), 'j-math');
    assert.equal(subjectFor('', '', students), 'physics', '没信息跟老师现有学生的学科');
    assert.equal(subjectFor('三年级', '道法', students), 'p-politics');
    assert.equal(subjectFor('高一', '', [S('m', '甲', { subject: 'j-math' })]), 'math', '学段换了，科目跟着老师常教的');
  });

  await ok('预览与写入：合并时冲突跳过、改用导入时替换旧课；替换模式清掉这些学生以后的课；导入的两节互撞只留前一节；新学生只建一次', () => {
    const slots: LessonSlot[] = [
      { id: 's1', studentId: 'a', date: '2026-10-19', day: 0, start: 19, len: 1.5, topic: '旧周一', repeat: true },
      { id: 's2', studentId: 'b', date: '2026-10-20', day: 1, start: 19, len: 2, topic: '欣怡周二', repeat: true },
      { id: 's3', studentId: 'a', date: '2026-10-10', day: 5, start: 10, len: 2, topic: '上周六的单次课' },
    ];
    const lessons = lessonsFromJson({ lessons: [
      { student: '俊宇', day: '周一', start: '19:30', end: '21:00', repeat: true },
      { student: '李明', grade: '初二', subject: '数学', day: '周二', start: '20:00', end: '21:00' },
      { student: '李明', day: '周四', start: '19:00', end: '20:00' },
      { student: '欣怡', day: '周四', start: '19:30', end: '20:30' },
      { student: '欣怡', day: '周五', start: '6:00', end: '7:00', topic: '早课' },
    ] }, today).lessons;
    const rows = rowsOf(lessons, students);
    assert.deepEqual(rows.map((r) => r.studentId), ['a', NEW, NEW, 'b', 'b']);
    let k = 0;
    const base = { rows, students, slots, from: today, today, newId: () => 'n' + ++k };
    const keep = planImport({ ...base, mode: 'merge', onConflict: 'keep' });
    const st = rows.map((r) => keep.states[r.id].kind);
    assert.deepEqual(st, ['conflict', 'conflict', 'add', 'clash', 'add'], JSON.stringify(keep.states));
    assert.equal(keep.created.length, 1); assert.equal(keep.created[0].subject, 'j-math');
    assert.equal(keep.slots.length, 5);
    const thu = keep.slots.find((s) => s.topic === '一对一课程' && s.day === 3)!;
    assert.equal(thu.date, '2026-10-22', '每周课从生效日期起的第一个周四开始');
    assert.equal(thu.studentId, keep.created[0].id);
    const fri = keep.slots.find((s) => s.topic === '早课')!;
    assert.equal(fri.start, 18, '没写上下午的 6:00 按晚上');

    const swap = planImport({ ...base, mode: 'merge', onConflict: 'replace' });
    assert.equal(swap.states[rows[0].id].kind, 'replace');
    assert.deepEqual(swap.replaced.map((s) => s.id).sort(), ['s1', 's2']);
    assert.ok(!swap.slots.some((s) => s.id === 's1' || s.id === 's2'));

    const repl = planImport({ ...base, mode: 'replace', onConflict: 'keep' });
    assert.deepEqual(repl.removed.map((s) => s.id).sort(), ['s1', 's2'], '这些学生以后的课清掉，过去的单次课留着');
    assert.ok(repl.slots.some((s) => s.id === 's3'));
    assert.equal(repl.states[rows[0].id].kind, 'add');

    rows[0].use = false;
    const off = planImport({ ...base, rows, mode: 'merge', onConflict: 'keep' });
    assert.equal(off.states[rows[0].id].kind, 'off');
    // 1.4.0 起全天都能排课，22:30 开始的一小时课（过了午夜）可以导入；不满半小时的仍然不行
    const late = planImport({ ...base, rows: [{ id: 'x', studentId: 'a', use: true, lesson: { ...lessons[0], start: 22.5, len: 1 } }], mode: 'merge', onConflict: 'keep' });
    assert.equal(late.states.x.kind, 'add');
    const bad = planImport({ ...base, rows: [{ id: 'x', studentId: 'a', use: true, lesson: { ...lessons[0], start: 22.5, len: 0.25 } }], mode: 'merge', onConflict: 'keep' });
    assert.equal(bad.states.x.kind, 'invalid');
    assert.equal(whenText({ day: 3, date: '', start: 19, len: 1.5, repeat: true }), '每周四 19:00–20:30');
    assert.equal(whenText({ day: 5, date: '2026-10-24', start: 14, len: 2, repeat: false }), '10月24日 周六 14:00–16:00');
  });

  await ok('Excel：共享字符串、时间小数、日期样式、合并单元格；Word：段落和表格', async () => {
    const ss = '<sst><si><t>时间</t></si><si><t>周一</t></si><si><r><t>俊宇</t></r><r><t xml:space="preserve"> 物理</t></r><rPh><t>ジュン</t></rPh></si><si><t>开始</t></si></sst>';
    const shared = sharedStrings(ss);
    assert.deepEqual(shared, ['时间', '周一', '俊宇 物理', '开始']);
    const styles = '<styleSheet><numFmts><numFmt numFmtId="176" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="20" applyNumberFormat="1"/><xf numFmtId="176"/></cellXfs></styleSheet>';
    const ds = dateStyleSet(styles);
    assert.deepEqual([...ds], [2]);
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>'
      + '<row r="2"><c r="A2" s="1"><v>0.791666666666667</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" s="2"><v>46320</v></c></row><row r="3" spans="1:3"/>'
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>备注 &amp; 说明</t></is></c></row></sheetData><mergeCells><mergeCell ref="B2:B3"/></mergeCells></worksheet>';
    assert.equal(sheetText(sheet, shared, ds), '时间\t周一\t开始\n19:00\t俊宇 物理\t2026-10-25\n\t俊宇 物理\n备注 & 说明');
    const doc = '<w:document><w:body><w:p><w:r><w:t>秋季课表</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>时间</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>周一</w:t></w:r></w:p></w:tc></w:tr>'
      + '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>19:00-20:30</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>俊宇</w:t></w:r></w:p><w:p><w:r><w:t>欣怡</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>';
    const text = docxText(doc);
    assert.equal(text, '秋季课表\n时间\t周一\n19:00-20:30\t俊宇 / 欣怡');
    const l = lessonsByRules(text, ['俊宇', '欣怡'], today);
    assert.deepEqual(l.map((x) => x.student).sort(), ['俊宇', '欣怡'], '一格里写了两个学生拆成两节');
    // 真 zip 能被 jszip 读出来（导入时走同一条路）
    const zip = new JSZip(); zip.file('xl/sharedStrings.xml', ss); zip.file('xl/worksheets/sheet1.xml', sheet);
    const back = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    assert.equal(sharedStrings(await back.file('xl/sharedStrings.xml')!.async('string'))[2], '俊宇 物理');
  });

  console.log(`${n}/7 通过`);
})().catch((e) => { console.error(e); process.exit(1); });
