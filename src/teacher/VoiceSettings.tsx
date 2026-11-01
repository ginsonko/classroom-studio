import { Loader2, Mic } from 'lucide-react';
import { asrApi, useAsr } from '../lib/asr';
import { toast } from '../lib/toast';

type Voice = { voiceTrack?: boolean; transcribe?: boolean };

/** 设置 → 课后语音转写：双声道音轨、自动转写开关、语音组件下载 */
export function VoiceSettings({ settings, update, busy }: { settings: Voice; update: (p: Voice) => void; busy: boolean }) {
  const state = useAsr((s) => s.state), setup = state?.setup;
  const act = (fn: () => Promise<unknown>) => void fn().then(() => useAsr.getState().load()).catch((e) => toast((e as Error).message));
  return <div className="desktop-section" data-qa="voice-settings"><h3><Mic size={15} />课后语音转写</h3>
    <label className="setting-check"><input type="checkbox" data-qa="voice-track" disabled={busy} checked={settings.voiceTrack !== false} onChange={(e) => update({ voiceTrack: e.target.checked })} />录课时另外存一条老师、学生分开的声音（左声道是麦克风，右声道是会议里的声音，每小时约 30 MB）</label>
    <label className="setting-check"><input type="checkbox" data-qa="voice-transcribe" checked={settings.transcribe !== false} onChange={(e) => update({ transcribe: e.target.checked })} />下课后在这台电脑上把这节课的话转成文字，分清老师和学生</label>
    {setup && !setup.supported && <p className="warn-line">这台电脑的系统暂时不支持本地语音转写。</p>}
    {setup?.supported && <div className="voice-setup" data-qa="voice-setup">
      {setup.bundled ? <span className="voice-ok" data-qa="voice-bundled">语音组件已随软件装好，不用另外下载</span> : setup.installed && setup.phase !== 'running' ? <>
        <span className="voice-ok">语音组件已装好</span>
        <button className="link-btn" data-qa="voice-uninstall" disabled={!!state?.current} onClick={() => { if (confirm('删除语音组件（约 ' + setup.mb + ' MB）？已经转好的文字不受影响，以后要用时可以再下载。')) act(asrApi.uninstall); }}>删除组件</button>
      </> : setup.phase === 'running' ? <>
        <span><Loader2 size={13} className="ags-spin" />{setup.step}（{Math.round(setup.pct)}%）</span>
        <div className="rp-bar sm"><i style={{ width: `${setup.pct}%` }} /></div>
        <button className="link-btn" onClick={() => act(asrApi.cancelInstall)}>取消</button>
      </> : <>
        {setup.phase === 'error' && <span className="voice-err">{setup.error}</span>}
        <button className="sd-btn" data-qa="voice-install" onClick={() => act(asrApi.install)}>{setup.phase === 'error' ? '重试下载' : `下载语音组件（约 ${setup.mb} MB）`}</button>
      </>}
    </div>}
    {state?.current && <p className="voice-now" data-qa="voice-now"><Loader2 size={12} className="ags-spin" />正在转写「{state.current.title || '课堂回放'}」{Math.round(state.current.pct * 100)}%{state.queue.length ? `，后面还有 ${state.queue.length} 节` : ''}</p>}
    {!state?.current && state?.paused && state.queue.length > 0 && <p className="voice-now">正在上课，{state.queue.length} 节课的转写等下课后接着做</p>}
    <p>识别用的是阿里开源的 SenseVoice 模型，全部在本机运行，不联网、不花钱；录音和文字只存在这台电脑上，发给 AI 分析的只有文字。一小时的课大约 3～5 分钟转完，只在没上课、回放也生成完的时候转，转到一半开始上课会先停下，下课后再转。戴耳机上课效果最好；用音箱外放时，学生的声音会漏进麦克风，软件会按音量判断是谁说的。转好的文字在「课堂回放」里看：字幕跟着回放走，可以搜原话、点一句跳到那个时刻。</p>
  </div>;
}
