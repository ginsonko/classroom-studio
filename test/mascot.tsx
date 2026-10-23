// 助教形象预览页（vite 托管）：?still=1 定格每个表情的关键姿势，方便截图。
import '@fontsource-variable/inter';
import '../src/styles/assistant.css';
import { createRoot } from 'react-dom/client';
import { Mascot, type Mood } from '../src/assistant/Mascot';

const still = new URLSearchParams(location.search).get('still') === '1';
const MOODS: [Mood, string, string][] = [
  ['idle', '待机', '呼吸、眨眼、眼睛跟着鼠标'], ['think', '思考', '抬眼看、冒省略号'], ['talk', '说话', '张嘴、翅膀比划'], ['happy', '开心', '眯眼笑、蹦跳、冒心心'],
  ['work', '干活', '抱着铅笔唰唰写'], ['alert', '提醒', '呆毛竖起、感叹号'], ['sleep', '睡着', '没配置好时打盹'],
];
const cls = still ? 'still' : '';

createRoot(document.getElementById('root')!).render(
  <div className="sheet">
    <div className="hero">
      <Mascot mood="happy" size={230} className={cls} />
      <div>
        <h1>小羽<small>最强网课教辅系统 · AI 助教</small></h1>
        <p>一只圆滚滚的<em>小羽毛鸟</em>：头顶一根羽毛呆毛（名字「羽」的来历），<br />戴着红色蝴蝶结——结上是软件标志里的<em>播放三角</em>，身体是软件的青蓝主色。</p>
        <p>翅膀里总抱着一支铅笔，随时准备帮老师排课、找题、写反馈。</p>
        <p>右下角常驻，眼睛会跟着鼠标转；思考、说话、干活、提醒时各有动作。</p>
      </div>
    </div>
    <div className="row dark">{MOODS.map(([m, n, d]) => <div key={m} className="cell"><Mascot mood={m} size={140} className={cls} /><b>{n}</b><i>{d}</i></div>)}</div>
    <div className="light"><div className="row">{MOODS.map(([m, n]) => <div key={m} className="cell"><Mascot mood={m} size={120} className={cls} /><b>{n}</b></div>)}</div></div>
    <div className="chat">
      <Mascot mood="talk" size={86} className={cls} />
      <div className="bub">老师好呀，我是你的 AI 助教<b>小羽</b>～<br />「周三晚上七点给俊宇加一节课」「把今天的错题组成作业」，跟我说一声就行。</div>
      <span style={{ flex: 1 }} />
      <Mascot mood="alert" size={86} className={cls} />
      <div className="bub">老师，<b>俊宇 19:00 的课</b>还有 10 分钟开始，要不要先看看他上次的错题？</div>
    </div>
  </div>,
);
