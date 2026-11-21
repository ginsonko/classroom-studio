// 1.8.0「课后发家长」统一交付抽屉（AfterClassDeliver）：
// 解决老师下课后回放录像（及微信分段）、课堂总结与六宫格长图、当堂板书 PDF、课后作业散落四处，
// 且点开核对时容易误跳回上课预监的痛点。
//
// 核心体验：
// 1. 按「每一堂课」自动归拢四大件：回放视频（超 58 分钟优先勾选微信分段，未切支持当场一键秒切）、
//    课后总结与家长反馈长图（支持原地改字、一键生成总结与长图）、课堂板书 PDF、课后作业（答案版自动折叠不默认勾，防手滑发给学生）。
// 2. 点击任意文件都在当前抽屉上方弹出独立原地轻预览（QuickPreview），绝不跳回上课导播台、绝不顶掉下节课预监。
// 3. 按住单个卡片或底部「整套勾选项拖进微信群」手柄往电脑版微信一松手，即走 Electron startDrag 原生文件拖放，
//    并自动用硬链接换上家长一眼看懂的干净中文文件名（如「林晓-11月21日-物理课回放.mp4」）；同时支持一键复制文件（微信 Ctrl+V）与复制家长话术。
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  BookOpen, Check, ChevronDown, ChevronRight, Clapperboard, ClipboardCopy, Copy, Eye,
  FilePlus2, FileText, FolderOpen, GripHorizontal, ImageDown, Loader2, Lock, PackageCheck,
  Scissors, Send, Sparkles, Video, X,
} from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { ensureStudy, useStudy } from '../lib/studyStore';
import { fmtBytes, isLive, useRecording, type RecordRow } from '../lib/recording';
import { buildLessonNote, dayKey, lessonDocument, saveLesson } from '../lib/studyActions';
import { archiveBoards, classHasContent } from '../lib/classReset';
import { isGroup, membersOf } from '../lib/groups';
import { packOf, studentSubject } from '../lib/subjects';
import { parentMessage, type Homework, type LessonNote, type SendRecord, type StudentFile } from '../lib/studyLogic';
import type { Student } from '../lib/types';
import { openQuickPreview } from '../ui/QuickPreview';
import { SendSheet, useNotify } from './ParentSend';
import { baseName, cleanPath } from '../lib/pathText';
import { toast } from '../lib/toast';
import '../styles/deliver.css';

export interface DeliverOpenOpts {
  recordId?: string;
  studentId?: string;
  date?: string;
}

interface DeliverStoreState {
  open: boolean;
  opts: DeliverOpenOpts | null;
  sentMap: Record<string, { at: string; channel: string; count: number }>;
  loadedSent: boolean;
}

export const useDeliverDrawer = create<DeliverStoreState>()(() => ({
  open: false,
  opts: null,
  sentMap: {},
  loadedSent: false,
}));

export function openDeliverDrawer(opts: DeliverOpenOpts = {}) {
  ensureStudy();
  useDeliverDrawer.setState({ open: true, opts });
  if (host.electron) {
    void host.call<Record<string, { at: string; channel: string; count: number }>>('deliver.sentState')
      .then((sentMap) => useDeliverDrawer.setState({ sentMap, loadedSent: true }))
      .catch(() => {});
  }
}

export function closeDeliverDrawer() {
  useDeliverDrawer.setState({ open: false });
}

/** 判断文件名是否属于答案/解析/教师版（默认不勾选并收纳折叠，防连堂课手滑误发到学生群） */
export function isAnswerLikeFile(filePath: string, label = ''): boolean {
  const s = `${baseName(filePath)} ${label}`;
  return /(答案版|解析版|教师版|含答案|带答案|有答案|详解版|参考答案)/.test(s) && !/(不含答案|无答案|学生版|原卷版)/.test(s);
}

/** 格式化为「11月21日」供给家长的文件名使用 */
function mdLabel(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export interface DeliverFileItem {
  id: string;
  category: 'video' | 'report' | 'board' | 'homework' | 'extra';
  path: string;
  title: string;
  meta: string;
  niceName: string;
  defaultChecked: boolean;
  answerGuard?: boolean;
}

export interface LessonBundle {
  key: string;
  date: string;
  sortTime: number;
  studentId: string;
  studentName: string;
  subjectName: string;
  isGroupLesson: boolean;
  groupMembers: Student[];
  record?: RecordRow;
  durationMin: number | null;
  notesByStudent: Map<string, LessonNote>;
  boardFiles: StudentFile[];
  homeworks: Homework[];
  docFiles: StudentFile[];
}

/** 将录像、课后总结、当天板书与作业智能聚合成按堂排列的「课后交付袋」 */
function buildBundles(
  records: RecordRow[],
  students: Student[],
  lessons: LessonNote[],
  files: StudentFile[],
  homeworks: Homework[],
): LessonBundle[] {
  const stuMap = new Map(students.map((s) => [s.id, s]));
  const bundles = new Map<string, LessonBundle>();

  const ensureBundle = (studentId: string, date: string, sortTime: number, record?: RecordRow): LessonBundle => {
    const sid = studentId || 'free';
    // 同一学生同一天有多段录像时按 record.id 独立成堂；无录像时按 sid@date 聚合
    const exactKey = record ? `rec:${record.id}` : `day:${sid}@${date}`;
    const existing = bundles.get(exactKey);
    if (existing) return existing;

    const stu = stuMap.get(sid);
    const grp = stu && isGroup(stu);
    const members = grp ? membersOf(stu, students) : [];
    const pack = packOf(studentSubject(stu));
    const dur = record?.startedAt && record?.endedAt ? Math.max(1, Math.round((record.endedAt - record.startedAt) / 60_000)) : null;

    const b: LessonBundle = {
      key: exactKey,
      date,
      sortTime,
      studentId: sid,
      studentName: stu?.name || (sid === 'free' ? '自由课堂' : '未命名学生'),
      subjectName: pack.name,
      isGroupLesson: !!grp,
      groupMembers: members,
      record,
      durationMin: dur,
      notesByStudent: new Map(),
      boardFiles: [],
      homeworks: [],
      docFiles: [],
    };
    bundles.set(exactKey, b);
    return b;
  };

  // 1. 先放入已完成或正在转换的课堂录像
  const sortedRecs = [...records]
    .filter((r) => !isLive(r.phase))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (const r of sortedRecs) {
    const t = r.endedAt || r.startedAt || new Date(r.createdAt).getTime() || Date.now();
    const d = dayKey(r.startedAt || r.createdAt || t);
    ensureBundle(r.studentId || 'free', d, t, r);
  }

  // 判断某个课堂交付袋是否归属该学生（含一对二/班组课成员归属）
  const belongsToStudent = (b: LessonBundle, sid: string): boolean =>
    b.studentId === sid || (b.isGroupLesson && b.groupMembers.some((m) => m.id === sid));

  // 查找某学生最匹配的课堂交付袋：
  // 1. 优先匹配同一自然日（b.date === date）的堂次；同一天有多堂课时按时间距离就近归入；
  // 2. 兼容跨零点夜课（如 23:00 开课、00:10 下课后保存板书/导出作业/生成总结）：
  //    若当日尚无堂次，但该学生有一堂跨零点结束在 date 当天（或下课后 4 小时内生成该资料）的录像堂次，
  //    则自动归入这堂刚下课的录像堂次，避免跨午夜把同一堂课拆成两个条目；
  // 3. 若均未命中，则按 sid@date 新建无录像堂次。
  const matchDayBundle = (sid: string, date: string, itemTime: number): LessonBundle => {
    let bestSameDay: LessonBundle | null = null;
    let bestSameDayGap = Infinity;
    for (const b of bundles.values()) {
      if (b.date !== date || !belongsToStudent(b, sid)) continue;
      const gap = Math.abs(b.sortTime - itemTime);
      if (gap < bestSameDayGap) {
        bestSameDay = b;
        bestSameDayGap = gap;
      }
    }
    if (bestSameDay) return bestSameDay;

    let bestCrossMidnight: LessonBundle | null = null;
    let bestCrossGap = Infinity;
    for (const b of bundles.values()) {
      if (!b.record || !belongsToStudent(b, sid)) continue;
      const recStart = b.record.startedAt || new Date(b.record.createdAt).getTime() || b.sortTime;
      const recEnd = b.record.endedAt || recStart;
      const endedOnDate = Boolean(b.record.endedAt && dayKey(b.record.endedAt) === date);
      const nearAfterClass = itemTime >= recStart - 30 * 60_000 && itemTime <= recEnd + 4 * 3600_000;
      if (!endedOnDate && !nearAfterClass) continue;
      const gap = Math.abs(recEnd - itemTime);
      if (gap < bestCrossGap) {
        bestCrossMidnight = b;
        bestCrossGap = gap;
      }
    }
    if (bestCrossMidnight) return bestCrossMidnight;

    return ensureBundle(sid, date, itemTime);
  };

  // 2. 挂入课后总结（含班组课成员各自的总结）
  for (const l of lessons) {
    const targetSid = l.groupId || l.studentId;
    const t = new Date(l.at || l.date).getTime() || Date.now();
    const b = matchDayBundle(targetSid, l.date, t);
    if (!b.notesByStudent.has(l.studentId)) {
      b.notesByStudent.set(l.studentId, l);
    }
    if (!b.durationMin && l.minutes) b.durationMin = l.minutes;
  }

  // 3. 挂入当天板书与归档文件
  for (const f of files) {
    if (!f.studentId || f.studentId === 'free') continue;
    const t = new Date(f.at).getTime() || Date.now();
    const d = dayKey(t);
    const b = matchDayBundle(f.studentId, d, t);
    if (f.kind === 'board') b.boardFiles.push(f);
    else b.docFiles.push(f);
  }

  // 4. 挂入当天导出的课后作业（兼容旧存档 createdAt 字段）
  for (const hw of homeworks) {
    if (!hw.studentId) continue;
    const rawAt = hw.at || (hw as { createdAt?: string }).createdAt || '';
    const t = new Date(rawAt).getTime() || Date.now();
    const d = dayKey(t);
    const b = matchDayBundle(hw.studentId, d, t);
    b.homeworks.push(hw);
  }

  return [...bundles.values()].sort((a, b) => b.sortTime - a.sortTime).slice(0, 60);
}

/** 顶栏右侧常驻「发家长」快捷入口按钮（有今日未发完的课次时显示温和数字徽标） */
export function DeliverTopButton() {
  const rev = useRecording((s) => s.rev);
  const sentMap = useDeliverDrawer((s) => s.sentMap);
  const students = useStore((s) => s.students);
  const studyLessons = useStudy((s) => s.data.lessons);
  const [todayUnsent, setTodayUnsent] = useState(0);

  useEffect(() => {
    if (!host.electron) return;
    let cancelled = false;
    Promise.all([
      host.call<RecordRow[]>('recordings').catch(() => []),
      host.call<Record<string, { at: string; channel: string; count: number }>>('deliver.sentState').catch((): Record<string, { at: string; channel: string; count: number }> => ({})),
    ]).then(([rows, sent]) => {
      if (cancelled) return;
      useDeliverDrawer.setState({ sentMap: sent, loadedSent: true });
      const todayStr = dayKey(Date.now());
      const todayRecs = rows.filter(
        (r) => !isLive(r.phase) && (dayKey(r.startedAt || r.createdAt) === todayStr || (Boolean(r.endedAt) && dayKey(r.endedAt!) === todayStr)),
      );
      const unsent = todayRecs.filter((r) => !sent[`rec:${r.id}`]).length;
      setTodayUnsent(unsent);
    });
    return () => { cancelled = true; };
  }, [rev, studyLessons.length, students.length, Object.keys(sentMap).length]);

  return (
    <button
      className={'tb-deliver' + (todayUnsent > 0 ? ' has' : '')}
      data-qa="top-deliver-btn"
      onClick={() => openDeliverDrawer()}
      data-tip="课后发家长：把每堂课的回放（微信分段）、总结长图、板书和作业聚在一起，原地预览后直接拖进微信群"
    >
      <PackageCheck size={14} />
      <span>发家长</span>
      {todayUnsent > 0 && <em className="num">{todayUnsent}</em>}
    </button>
  );
}

export function AfterClassDeliver() {
  const { open, opts, sentMap } = useDeliverDrawer();
  const students = useStore((s) => s.students);
  const currentStudentId = useStore((s) => s.studentId);
  const study = useStudy((s) => s.data);
  const updateStudy = useStudy((s) => s.update);
  const rev = useRecording((s) => s.rev);
  const jobs = useRecording((s) => s.status.jobs);

  const [records, setRecords] = useState<RecordRow[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [memberId, setMemberId] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [extraFiles, setExtraFiles] = useState<Record<string, string[]>>({});
  const [showAnswers, setShowAnswers] = useState(false);
  const [parentDraft, setParentDraft] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadRecords = async () => {
    if (!host.electron) return;
    try {
      const [rows, sent] = await Promise.all([
        host.call<RecordRow[]>('recordings'),
        host.call<Record<string, { at: string; channel: string; count: number }>>('deliver.sentState'),
      ]);
      setRecords(rows);
      useDeliverDrawer.setState({ sentMap: sent, loadedSent: true });
    } catch { /* 忽略 */ }
  };

  useEffect(() => {
    if (!open) return;
    void useNotify.getState().refresh();
    void loadRecords();
  }, [open, rev, jobs?.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 如果上层开着 QuickPreview，由 QuickPreview 先接管 Esc
      if (document.querySelector('[data-qa="quick-preview"]')) return;
      if (e.key === 'Escape' && !sendSheetOpen) closeDeliverDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sendSheetOpen]);

  const bundles = useMemo(
    () => buildBundles(records, students, study.lessons ?? [], study.files ?? [], study.homework ?? []),
    [records, students, study.lessons, study.files, study.homework],
  );

  // 打开抽屉时根据传入参数定位到指定课次（默认选最近一堂）
  useEffect(() => {
    if (!open || !bundles.length) return;
    if (opts?.recordId) {
      const hit = bundles.find((b) => b.record?.id === opts.recordId);
      if (hit) { setSelectedKey(hit.key); return; }
    }
    if (opts?.studentId) {
      const hit = bundles.find((b) => (b.studentId === opts.studentId || b.groupMembers.some((m) => m.id === opts.studentId)) && (!opts.date || b.date === opts.date));
      if (hit) {
        setSelectedKey(hit.key);
        if (hit.isGroupLesson && hit.groupMembers.some((m) => m.id === opts.studentId)) setMemberId(opts.studentId);
        return;
      }
    }
    if (!selectedKey || !bundles.some((b) => b.key === selectedKey)) {
      // 若录像列表异步返回后把原本选中的 day:sid@date 合并升级成了 rec:xxx，保持停留在同一堂课不乱跳回首项
      const dayMatch = /^day:([^@]+)@(.+)$/.exec(selectedKey);
      const upgraded = dayMatch ? bundles.find((b) => b.studentId === dayMatch[1] && b.date === dayMatch[2]) : undefined;
      setSelectedKey((upgraded ?? bundles[0]).key);
    }
  }, [open, opts, bundles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = bundles.find((b) => b.key === selectedKey) ?? bundles[0] ?? null;
  const targetStudent: Student | undefined = useMemo(() => {
    if (!active) return undefined;
    if (active.isGroupLesson) {
      return active.groupMembers.find((m) => m.id === memberId) ?? active.groupMembers[0];
    }
    return students.find((s) => s.id === active.studentId);
  }, [active, memberId, students]);

  const activeNote: LessonNote | undefined = useMemo(() => {
    if (!active) return undefined;
    const sid = targetStudent?.id || active.studentId;
    return active.notesByStudent.get(sid) ?? study.lessons.find((l) => l.studentId === sid && l.date === active.date);
  }, [active, targetStudent, study.lessons]);

  // 切换课次或班组成员时同步评语草稿
  useEffect(() => {
    if (!active) return;
    setParentDraft(activeNote?.parent ?? '');
    setTopicDraft(activeNote?.topic || active.record?.title || targetStudent?.lastTopic || '');
    setShowAnswers(false);
  }, [active?.key, targetStudent?.id, activeNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 组装当前课次的全部可交付文件清单
  const allItems = useMemo<DeliverFileItem[]>(() => {
    if (!active) return [];
    const out: DeliverFileItem[] = [];
    const seenPaths = new Set<string>();
    const stuLabel = targetStudent?.name || active.studentName;
    const dateTag = mdLabel(active.date);
    const prefix = `${stuLabel}-${dateTag}-${active.subjectName}`;

    const pushItem = (it: DeliverFileItem) => {
      const norm = cleanPath(it.path);
      if (!norm || seenPaths.has(norm)) return;
      seenPaths.add(norm);
      out.push({ ...it, path: norm });
    };

    // 1. 回放视频与微信分段
    const rec = active.record;
    if (rec && rec.phase === 'complete') {
      const parts = rec.parts ?? [];
      const overHour = (active.durationMin ?? 0) > 58;
      if (parts.length > 0) {
        parts.forEach((p, idx) => {
          pushItem({
            id: `part-${idx}`,
            category: 'video',
            path: p.path,
            title: `课堂回放 · 微信分段 ${idx + 1}/${parts.length}`,
            meta: `${Math.max(1, Math.round(p.seconds / 60))} 分钟 · ${fmtBytes(p.bytes)} · 适合直接发微信`,
            niceName: `${prefix}课回放-第${idx + 1}段.mp4`,
            defaultChecked: true,
          });
        });
        if (rec.mp4) {
          pushItem({
            id: 'rec-full',
            category: 'video',
            path: rec.mp4,
            title: '完整未分段原片',
            meta: `${active.durationMin ?? '?'} 分钟 · ${fmtBytes(rec.bytes)}（已选上方微信分段，原片默认不重复发）`,
            niceName: `${prefix}课完整回放.mp4`,
            defaultChecked: false,
          });
        }
      } else if (rec.mp4) {
        pushItem({
          id: 'rec-full',
          category: 'video',
          path: rec.mp4,
          title: '课堂回放视频',
          meta: `${active.durationMin ? `${active.durationMin} 分钟 · ` : ''}${fmtBytes(rec.bytes)}${overHour ? ' · 超过 1 小时建议先点右侧切成微信分段' : ''}`,
          niceName: `${prefix}课回放.mp4`,
          defaultChecked: !overHour,
        });
      }
    }

    // 2. 课后总结分享长图与文档
    const noteFiles = [...(activeNote?.files ?? [])];
    const latestPng = [...noteFiles].reverse().find((f) => /\.png$/i.test(f));
    if (latestPng) {
      pushItem({
        id: 'note-png',
        category: 'report',
        path: latestPng,
        title: '家长版课后反馈长图',
        meta: '六宫格清爽排版 · 适合发家长微信查看',
        niceName: `${stuLabel}-${dateTag}-课后反馈长图.png`,
        defaultChecked: true,
      });
    }
    for (const f of noteFiles) {
      if (f === latestPng || !/\.(pdf|docx?)$/i.test(f)) continue;
      const ext = f.split('.').pop()?.toLowerCase() || 'pdf';
      pushItem({
        id: `note-doc-${f}`,
        category: 'report',
        path: f,
        title: `课后总结文档（${ext.toUpperCase()}）`,
        meta: baseName(f),
        niceName: `${stuLabel}-${dateTag}-课后总结.${ext}`,
        defaultChecked: false,
      });
    }

    // 3. 当堂板书归档（同天 PDF 默认勾选，长图可选）
    active.boardFiles.forEach((bf, idx) => {
      const ext = bf.path.split('.').pop()?.toLowerCase() || 'pdf';
      const isPdf = ext === 'pdf';
      const suffix = active.boardFiles.length > 1 ? `-${idx + 1}` : '';
      pushItem({
        id: `board-${bf.id || idx}`,
        category: 'board',
        path: bf.path,
        title: bf.title || `课堂板书${suffix}`,
        meta: isPdf ? '高清矢量板书 PDF · 学生手机可直接翻看复习' : '板书拼接长图',
        niceName: `${stuLabel}-${dateTag}-课堂板书${suffix}.${ext}`,
        defaultChecked: isPdf,
      });
    });

    // 4. 课后作业与关联资料（自动识别答案卷折叠防误发）
    const sid = targetStudent?.id || active.studentId;
    const myHomeworks = active.homeworks.filter((h) => h.studentId === sid || h.studentId === active.studentId);
    myHomeworks.forEach((hw, hi) => {
      hw.files.forEach((fp, fi) => {
        const ext = fp.split('.').pop()?.toLowerCase() || 'pdf';
        const ans = isAnswerLikeFile(fp, hw.title);
        pushItem({
          id: `hw-${hi}-${fi}`,
          category: 'homework',
          path: fp,
          title: `${hw.title}（${ext.toUpperCase()}）`,
          meta: ans ? '含答案/解析 · 默认折叠不发学生群' : `共 ${hw.questionIds.length} 题 · ${ext === 'pdf' ? 'PDF 推荐发群' : 'Word 可编辑'}`,
          niceName: `${stuLabel}-${dateTag}-课后作业${myHomeworks.length > 1 ? `-${hi + 1}` : ''}.${ext}`,
          defaultChecked: !ans && ext === 'pdf',
          answerGuard: ans,
        });
      });
    });

    active.docFiles.forEach((df, di) => {
      const ext = df.path.split('.').pop()?.toLowerCase() || 'pdf';
      const ans = isAnswerLikeFile(df.path, df.title);
      const cleanTitle = (df.title || '课堂资料').replace(/\.[a-z0-9]{1,5}$/i, '');
      pushItem({
        id: `doc-${df.id || di}`,
        category: 'homework',
        path: df.path,
        title: df.title || baseName(df.path),
        meta: ans ? '含答案/解析 · 默认不勾选' : '当天归档学习资料',
        niceName: `${stuLabel}-${dateTag}-${cleanTitle}.${ext}`,
        defaultChecked: false,
        answerGuard: ans,
      });
    });

    // 5. 老师临时手动加入的文件
    for (const ep of extraFiles[active.key] ?? []) {
      const ext = ep.split('.').pop()?.toLowerCase() || '';
      pushItem({
        id: `extra-${ep}`,
        category: 'extra',
        path: ep,
        title: baseName(ep),
        meta: '手动添加的附件',
        niceName: baseName(ep),
        defaultChecked: true,
        answerGuard: isAnswerLikeFile(ep),
      });
    }

    return out;
  }, [active, targetStudent, activeNote, extraFiles]);

  const isItemChecked = (it: DeliverFileItem) => {
    const k = `${active?.key || ''}::${it.path}`;
    return k in checked ? checked[k] : it.defaultChecked;
  };
  const toggleItem = (it: DeliverFileItem) => {
    if (!active) return;
    const k = `${active.key}::${it.path}`;
    setChecked((prev) => ({ ...prev, [k]: !isItemChecked(it) }));
  };

  const selectedItems = allItems.filter(isItemChecked);
  const normalItems = allItems.filter((it) => !it.answerGuard);
  const answerItems = allItems.filter((it) => it.answerGuard);

  if (!open) return null;

  const markSentState = async (lessonKey: string, unset = false) => {
    if (!host.electron) return;
    const sentMapNext = await host.call<Record<string, { at: string; channel: string; count: number }>>('deliver.markSent', {
      lessonKey,
      unset,
      channel: 'manual',
      count: selectedItems.length,
    });
    useDeliverDrawer.setState({ sentMap: sentMapNext });
  };

  /** 一键切成微信分段 */
  const splitForWeChat = async () => {
    if (!active?.record) return;
    setBusy('split');
    try {
      const job = host.call('splitRecording', active.record.id);
      await new Promise((r) => setTimeout(r, 350));
      await loadRecords();
      await job;
      await loadRecords();
      toast('微信分段已切好，已自动为你勾选分段视频');
    } catch (e) {
      toast('切分失败：' + (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  /** 当场生成课后总结并导出六宫格家长反馈长图 */
  const generateNoteAndCard = async (onlyCard = false) => {
    if (!active) return;
    const sid = targetStudent?.id || active.studentId;
    if (!sid || sid === 'free') {
      toast('这堂课是未绑定学生的自由课堂，请先在学生页或回放归档里绑定学生');
      return;
    }
    const stuName = targetStudent?.name || active.studentName;
    setBusy(onlyCard ? 'card' : 'note');
    try {
      let note = activeNote;
      if (!note || !onlyCard) {
        const built = await buildLessonNote({
          studentId: sid,
          name: stuName,
          date: active.date,
          topic: topicDraft.trim() || active.record?.title || '课堂学习反馈',
          minutes: active.durationMin ?? undefined,
          id: note?.id,
          groupId: active.isGroupLesson ? active.studentId : undefined,
        });
        note = built.note;
      } else if (parentDraft.trim() && parentDraft !== note.parent) {
        note = { ...note, parent: parentDraft, topic: topicDraft || note.topic };
      }
      saveLesson(note);
      setParentDraft(note.parent);
      setTopicDraft(note.topic);
      const out = await lessonDocument(note, stuName, ['png']);
      if (out.errors?.length && !out.out.length) throw new Error(out.errors[0]);
      toast(`「${stuName}」的家长反馈与六宫格长图已生成就绪`);
    } catch (e) {
      toast('生成失败：' + (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  /** 保存老师顺手修改的「给家长的话」并同步刷新长图 */
  const saveEditedParentText = async (rebuildImg: boolean) => {
    if (!activeNote || !active) return;
    const stuName = targetStudent?.name || active.studentName;
    const nextNote: LessonNote = { ...activeNote, parent: parentDraft, topic: topicDraft || activeNote.topic };
    saveLesson(nextNote);
    if (rebuildImg) {
      setBusy('card');
      try {
        await lessonDocument(nextNote, stuName, ['png']);
        toast('已按新评语更新家长反馈长图');
      } catch (e) {
        toast('更新长图失败：' + (e as Error).message);
      } finally {
        setBusy('');
      }
    } else {
      toast('给家长的话已保存');
    }
  };

  /** 把当前黑板立即存成 PDF 归入本堂交付袋 */
  const archiveCurrentBoardNow = async () => {
    if (!active || active.studentId === 'free') return;
    setBusy('board');
    try {
      const saved = await archiveBoards(active.studentId);
      if (saved.length) toast(`已把 ${saved.length} 份黑板板书存成 PDF 加入本节交付袋`);
      else toast('当前黑板上还没有书写内容');
    } catch (e) {
      toast('保存板书失败：' + (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  /** 手动挑选本机文件加入本堂交付袋 */
  const addLocalFiles = async () => {
    if (!active || !host.electron) return;
    const picked = await host.pickFiles();
    if (!picked.length) return;
    setExtraFiles((prev) => ({
      ...prev,
      [active.key]: [...new Set([...(prev[active.key] ?? []), ...picked.map(cleanPath)])],
    }));
  };

  /** 原生拖放单个文件或整套已勾选文件进微信群 */
  const startDragItems = (e: React.DragEvent, items: DeliverFileItem[]) => {
    if (!host.electron || !host.startDrag || !items.length || !active) return;
    e.preventDefault();
    host.startDrag({
      items: items.map((x) => ({ path: x.path, niceName: x.niceName })),
      lessonKey: active.key,
    });
    // 同步刷新前端已发标记
    setTimeout(() => {
      void host.call<Record<string, { at: string; channel: string; count: number }>>('deliver.sentState')
        .then((sentMapNext) => useDeliverDrawer.setState({ sentMap: sentMapNext }))
        .catch(() => {});
    }, 300);
  };

  /** 一键复制所有已勾选文件到系统剪贴板（切微信按 Ctrl+V 直接发） */
  const copySelectedFiles = async () => {
    if (!active || !selectedItems.length) return;
    setBusy('copy');
    try {
      const r = await host.call<{ count: number }>('deliver.copyFiles', {
        items: selectedItems.map((x) => ({ path: x.path, niceName: x.niceName })),
        lessonKey: active.key,
      });
      setCopiedKey('files');
      setTimeout(() => setCopiedKey(''), 2200);
      await loadRecords();
      toast(`已复制 ${r.count} 个文件（已自动换好家长文件名），切到微信群按 Ctrl+V 即可发送`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  /** 一键复制给家长的话术文字 */
  const copyParentMessage = async () => {
    const stuName = targetStudent?.name || active?.studentName || '同学';
    const text = activeNote
      ? parentMessage({ ...activeNote, parent: parentDraft || activeNote.parent }, stuName, selectedItems.some((i) => i.id === 'note-png')).text
      : (parentDraft.trim() || `${stuName}家长您好，今天课程的回放录像、课堂板书和课后安排整理好了，发在群里供孩子复习参考，有问题随时沟通！`);
    await navigator.clipboard.writeText(text);
    setCopiedKey('text');
    setTimeout(() => setCopiedKey(''), 2000);
    toast('给家长的话已复制，可在微信里 Ctrl+V 粘贴');
  };

  const renderItemRow = (it: DeliverFileItem) => {
    const on = isItemChecked(it);
    const catBadge = it.category === 'video' ? '回放' : it.category === 'report' ? '反馈' : it.category === 'board' ? '板书' : it.category === 'homework' ? '作业' : '附件';
    return (
      <div key={it.id} className={'dlv-item' + (on ? ' on' : '') + (it.answerGuard ? ' ans' : '')} data-qa={'dlv-item-' + it.category}>
        <label className="dlv-chk" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={on} onChange={() => toggleItem(it)} />
        </label>
        <button
          type="button"
          className="dlv-item-main"
          data-qa="dlv-item-preview"
          onClick={() => openQuickPreview({ path: it.path, title: it.title, subtitle: `发给家长文件名：${it.niceName}`, niceName: it.niceName, lessonKey: active?.key })}
          data-tip="点击原地弹窗预览内容（不会跳转到上课预监）"
        >
          <span className={'dlv-tag c-' + it.category}>{catBadge}</span>
          <div className="dlv-item-txt">
            <b>{it.title}</b>
            <small>{it.meta} · <i>发群名：{it.niceName}</i></small>
          </div>
        </button>
        <div className="dlv-item-acts">
          <button
            type="button"
            className="dlv-mini"
            onClick={() => openQuickPreview({ path: it.path, title: it.title, subtitle: `发给家长文件名：${it.niceName}`, niceName: it.niceName, lessonKey: active?.key })}
            data-tip="原地预览核对"
          >
            <Eye size={13} />预览
          </button>
          {host.electron && (
            <button
              type="button"
              className="dlv-mini drag"
              draggable
              onDragStart={(e) => startDragItems(e, [it])}
              data-qa="dlv-single-drag"
              data-tip="按住这颗按钮直接拖进微信群，单独发送这一份文件"
            >
              <GripHorizontal size={13} />拖进微信
            </button>
          )}
          {host.electron && (
            <button type="button" className="dlv-ico" onClick={() => host.revealInFolder(it.path)} data-tip="打开所在文件夹" aria-label="打开所在文件夹">
              <FolderOpen size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const sentInfo = active ? sentMap[active.key] : undefined;
  const longImgPath = allItems.find((x) => x.id === 'note-png')?.path || '';

  return (
    <div
      className="dlv-bg"
      data-qa="deliver-drawer"
      onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) closeDeliverDrawer(); }}
    >
      <aside
        className={'dlv-panel' + (dragOver ? ' drop' : '')}
        role="dialog"
        aria-label="课后发家长统一交付台"
        onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={(e) => {
          if (!e.dataTransfer?.files.length || !active) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const ps = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter((p): p is string => !!p);
          if (ps.length) {
            setExtraFiles((prev) => ({ ...prev, [active.key]: [...new Set([...(prev[active.key] ?? []), ...ps.map(cleanPath)])] }));
            toast(`已把 ${ps.length} 个文件加入本堂课交付袋`);
          }
        }}
      >
        <header className="dlv-head">
          <div className="dlv-head-title">
            <PackageCheck size={20} className="dlv-logo" />
            <div>
              <h2>课后发家长 · 统一交付袋</h2>
              <p>每堂课的回放（微信分段）、总结长图、板书和作业都在这里 · 点文件原地秒看，按住直接拖进微信群</p>
            </div>
          </div>
          <button type="button" className="dlv-close" data-qa="dlv-close" onClick={closeDeliverDrawer} aria-label="关闭"><X size={18} /></button>
        </header>

        {!bundles.length ? (
          <div className="dlv-empty">
            <Clapperboard size={36} />
            <b>还没有已下课的课堂记录</b>
            <p>上完课保存录像、存下板书或生成课后总结后，会自动按每堂课整齐归拢到这里。</p>
          </div>
        ) : (
          <div className="dlv-main">
            {/* 左侧：最近各堂课列表（一眼分辨谁发过、谁还没发） */}
            <nav className="dlv-lessons" aria-label="最近课程列表">
              <div className="dlv-lessons-h">最近课次（共 {bundles.length} 节）</div>
              {bundles.map((b) => {
                const isSent = !!sentMap[b.key];
                const isCur = active?.key === b.key;
                const d = new Date(b.sortTime);
                const timeStr = !isNaN(+d) ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
                return (
                  <button
                    type="button"
                    key={b.key}
                    data-qa="dlv-lesson-item"
                    className={'dlv-l-btn' + (isCur ? ' on' : '') + (isSent ? ' sent' : '') + (b.studentId === currentStudentId ? ' cur-stu' : '')}
                    onClick={() => setSelectedKey(b.key)}
                  >
                    <div className="dlv-l-top">
                      <b>{b.studentName}</b>
                      <span className={'dlv-status' + (isSent ? ' ok' : '')}>{isSent ? '✓ 已发' : '待发'}</span>
                    </div>
                    <div className="dlv-l-sub num">
                      <span>{mdLabel(b.date)} {timeStr}</span>
                      {b.durationMin && <span>· {b.durationMin} 分钟</span>}
                    </div>
                    <div className="dlv-l-badges">
                      {b.record?.phase === 'complete' && <i>{b.record.parts?.length ? `分段×${b.record.parts.length}` : '回放'}</i>}
                      {b.notesByStudent.size > 0 && <i>总结</i>}
                      {b.boardFiles.length > 0 && <i>板书×{b.boardFiles.length}</i>}
                      {b.homeworks.length > 0 && <i>作业×{b.homeworks.length}</i>}
                    </div>
                  </button>
                );
              })}
            </nav>

            {/* 右侧：当前这堂课的核对、微调与一键拖进微信 */}
            {active && (
              <div className="dlv-detail">
                <div className="dlv-detail-bar">
                  <div>
                    <h3>{active.studentName} · {mdLabel(active.date)} {active.subjectName}课</h3>
                    <span className="dlv-sub">
                      {active.record?.phase === 'converting'
                        ? `回放视频正在后台合成中（${Math.round((active.record.progress ?? 0) * 100)}%），合成好会自动出现在下方`
                        : sentInfo
                          ? `已在 ${new Date(sentInfo.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 标记发送`
                          : '点击任意卡片可原地预览核对，勾选后按住底部大按钮直接拖进微信群'}
                    </span>
                  </div>
                  <div className="dlv-bar-acts">
                    <button
                      type="button"
                      className={'dlv-sent-toggle' + (sentInfo ? ' on' : '')}
                      data-qa="dlv-toggle-sent"
                      onClick={() => void markSentState(active.key, !!sentInfo)}
                    >
                      <Check size={13} />{sentInfo ? '已标为已发（点击改回待发）' : '标为已发家长'}
                    </button>
                  </div>
                </div>

                {/* 班组课：切换不同成员的总结与作业 */}
                {active.isGroupLesson && active.groupMembers.length > 0 && (
                  <div className="dlv-members">
                    <span>班组课成员（各自独立总结与长图）：</span>
                    {active.groupMembers.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        className={targetStudent?.id === m.id ? 'on' : ''}
                        onClick={() => setMemberId(m.id)}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}

                <div className="dlv-scroll">
                  {/* 快捷补齐提示条：超 1 小时未切分段 / 未存板书 / 添加额外文件 */}
                  <div className="dlv-quick-tools">
                    {active.record?.phase === 'complete' && !active.record.parts?.length && !active.record.splitting && (active.durationMin === null || active.durationMin > 58) && (
                      <button type="button" className="dlv-qbtn warn" disabled={!!busy} onClick={() => void splitForWeChat()} data-qa="dlv-split-wechat">
                        {busy === 'split' ? <Loader2 size={13} className="spin" /> : <Scissors size={13} />}
                        回放超 1 小时 · 一键切成微信分段
                      </button>
                    )}
                    {active.record?.splitting && (
                      <span className="dlv-qtip"><Loader2 size={13} className="spin" />正在切分微信分段视频…</span>
                    )}
                    {!active.boardFiles.length && active.studentId !== 'free' && classHasContent() && (
                      <button type="button" className="dlv-qbtn" disabled={!!busy} onClick={() => void archiveCurrentBoardNow()}>
                        {busy === 'board' ? <Loader2 size={13} className="spin" /> : <BookOpen size={13} />}
                        把当前课堂黑板存成 PDF 加入
                      </button>
                    )}
                    {host.electron && (
                      <button type="button" className="dlv-qbtn" onClick={() => void addLocalFiles()}>
                        <FilePlus2 size={13} />添加本机文件一起发
                      </button>
                    )}
                  </div>

                  {/* 文件清单区 */}
                  <section className="dlv-sec">
                    <div className="dlv-sec-h">
                      <b>本堂课待发文件（已勾 <span className="num">{selectedItems.length}</span> 项）</b>
                      <div className="dlv-sec-links">
                        {normalItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const allOn = normalItems.every(isItemChecked);
                              const next = { ...checked };
                              for (const it of normalItems) next[`${active.key}::${it.path}`] = !allOn;
                              setChecked(next);
                            }}
                          >
                            {normalItems.every(isItemChecked) ? '取消全选' : '全选学生可见项'}
                          </button>
                        )}
                      </div>
                    </div>

                    {normalItems.length === 0 ? (
                      <div className="dlv-no-files">
                        <Video size={18} />
                        <span>这堂课暂时还没有导出的文件（可在下方一键生成反馈长图，或把作业/资料拖进来）。</span>
                      </div>
                    ) : (
                      <div className="dlv-list">
                        {normalItems.map(renderItemRow)}
                      </div>
                    )}

                    {/* 答案版/教师版自动折叠防手滑误发 */}
                    {answerItems.length > 0 && (
                      <div className="dlv-ans-box" data-qa="dlv-answer-guard">
                        <button type="button" className="dlv-ans-toggle" onClick={() => setShowAnswers(!showAnswers)}>
                          <Lock size={13} />
                          <span>答案与解析版（{answerItems.length} 份 · 默认不勾选，防误发进学生群）</span>
                          {showAnswers ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {showAnswers && <div className="dlv-list">{answerItems.map(renderItemRow)}</div>}
                      </div>
                    )}
                  </section>

                  {/* 课后总结与给家长的话（支持原地核对微调、一键生成长图） */}
                  <section className="dlv-sec">
                    <div className="dlv-sec-h">
                      <b>给家长的话 & 课后反馈长图</b>
                      <div className="dlv-sec-links">
                        <button type="button" disabled={!!busy} onClick={() => void generateNoteAndCard(false)} data-qa="dlv-gen-note">
                          {busy === 'note' ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                          {activeNote ? '重新生成总结与长图' : '一键生成总结与长图'}
                        </button>
                      </div>
                    </div>
                    <div className="dlv-note-box">
                      <div className="dlv-topic-row">
                        <label>本节课题</label>
                        <input
                          value={topicDraft}
                          onChange={(e) => setTopicDraft(e.target.value)}
                          placeholder="例如：相互作用与共点力动态平衡"
                        />
                      </div>
                      <textarea
                        rows={4}
                        data-qa="dlv-parent-text"
                        value={parentDraft}
                        onChange={(e) => setParentDraft(e.target.value)}
                        placeholder="在这里查看或顺手改两句给家长的话；还没写时点右上角「一键生成总结与长图」…"
                      />
                      <div className="dlv-note-acts">
                        <button type="button" className="dlv-mini" onClick={() => void copyParentMessage()} data-qa="dlv-copy-text">
                          {copiedKey === 'text' ? <Check size={13} /> : <Copy size={13} />}
                          {copiedKey === 'text' ? '话术已复制' : '复制给家长的话'}
                        </button>
                        {activeNote && parentDraft !== activeNote.parent && (
                          <button type="button" className="dlv-mini" disabled={!!busy} onClick={() => void saveEditedParentText(false)}>
                            保存文字修改
                          </button>
                        )}
                        {activeNote && (
                          <button type="button" className="dlv-mini" disabled={!!busy} onClick={() => void saveEditedParentText(true)}>
                            {busy === 'card' ? <Loader2 size={13} className="spin" /> : <ImageDown size={13} />}
                            {longImgPath ? '按当前文字更新长图' : '导出六宫格长图'}
                          </button>
                        )}
                        {longImgPath && (
                          <button
                            type="button"
                            className="dlv-mini"
                            onClick={() => openQuickPreview({ path: longImgPath, title: '家长版课后反馈长图', niceName: `${targetStudent?.name || active.studentName}-${mdLabel(active.date)}-课后反馈长图.png`, lessonKey: active.key })}
                          >
                            <Eye size={13} />预览长图
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                {/* 底部一键拖进微信群 & 复制发送区 */}
                <footer className="dlv-foot">
                  <button
                    type="button"
                    className={'dlv-drag-all' + (!selectedItems.length ? ' disabled' : '')}
                    draggable={host.electron && selectedItems.length > 0}
                    disabled={!selectedItems.length}
                    onDragStart={(e) => startDragItems(e, selectedItems)}
                    onClick={() => {
                      if (selectedItems.length) toast('请按住这颗按钮不松手，直接拖到微信聊天窗口里松开即可发送文件；或者点右侧「一键复制所选文件」');
                    }}
                    data-qa="dlv-drag-all"
                  >
                    <GripHorizontal size={17} />
                    <span>
                      {selectedItems.length
                        ? `按住这里，把已选 ${selectedItems.length} 个文件直接拖进微信群`
                        : '请先在上方勾选要发送的文件'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="dlv-foot-btn"
                    disabled={!selectedItems.length || !!busy}
                    onClick={() => void copySelectedFiles()}
                    data-qa="dlv-copy-files"
                    data-tip="把已勾文件写入系统剪贴板，切到微信群直接按 Ctrl+V 即可粘贴发送"
                  >
                    {busy === 'copy' ? <Loader2 size={14} className="spin" /> : copiedKey === 'files' ? <Check size={14} /> : <ClipboardCopy size={14} />}
                    {copiedKey === 'files' ? '已复制，去微信 Ctrl+V' : '复制所选文件 (Ctrl+V)'}
                  </button>

                  {activeNote && targetStudent && (
                    <button
                      type="button"
                      className="dlv-foot-btn"
                      onClick={() => {
                        if (parentDraft !== activeNote.parent) saveLesson({ ...activeNote, parent: parentDraft });
                        setSendSheetOpen(true);
                      }}
                      data-tip="通过企业微信群机器人或邮件直接推送总结与长图"
                    >
                      <Send size={14} />企微 / 邮件
                    </button>
                  )}
                </footer>
              </div>
            )}
          </div>
        )}

        {dragOver && <div className="dlv-drop-mask"><FileText size={24} />松手把文件加入本堂课交付袋</div>}

        {sendSheetOpen && activeNote && targetStudent && (
          <SendSheet
            note={{ ...activeNote, parent: parentDraft || activeNote.parent }}
            student={targetStudent}
            image={longImgPath}
            makeImage={async () => {
              const r = await lessonDocument({ ...activeNote, parent: parentDraft || activeNote.parent }, targetStudent.name, ['png']);
              const p = r.out.find((f) => f.endsWith('.png'));
              if (!p) throw new Error(r.errors[0] || '没有生成长图');
              return p;
            }}
            onSent={(r: SendRecord[]) => {
              updateStudy((d) => ({
                ...d,
                lessons: d.lessons.map((l) => (l.id === activeNote.id ? { ...l, sends: [...(l.sends ?? []), ...r].slice(-30) } : l)),
              }));
              if (r.some((x) => x.ok) && active) void markSentState(active.key, false);
            }}
            onClose={() => setSendSheetOpen(false)}
          />
        )}
      </aside>
    </div>
  );
}
