import { Component, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/app.css';
import { ROLE, defaultView, useStore } from './lib/store';
import { boardMaterial } from './lib/library';
import { StudentApp } from './student/StudentApp';
import { TeacherApp } from './teacher/TeacherApp';
import { Tooltips } from './teacher/TeacherApp';
import { DockApp } from './dock/DockApp';
import {host} from './lib/host';
import { broadcastTheme, installPluginBridge } from './plugins/bridge';
if(host.test)void import('./lib/qa');
installPluginBridge();

/** 渲染出错时记日志并在短暂停顿后重新挂载，避免整个窗口变成一块点不动的空白 */
class Recover extends Component<{ children: ReactNode }, { failed: number }> {
  state = { failed: 0 };
  static getDerivedStateFromError() { return { failed: Date.now() }; }
  componentDidCatch(e: unknown) {
    console.error('[界面恢复] 渲染出错，已自动重新加载这一块界面:', e);
    setTimeout(() => this.setState({ failed: 0 }), 400);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

/** 教师导播台专属错误恢复边界：首次偶发异常自动重挂；若因异常预览状态连续报错，提供一键清理预览恢复面板，彻底杜绝教师端整窗黑屏 */
class TeacherRecover extends Component<{ children: ReactNode }, { failed: number; count: number; message: string }> {
  state = { failed: 0, count: 0, message: '' };
  static getDerivedStateFromError(e: unknown) {
    return { failed: Date.now(), message: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error('[教师端界面恢复] 捕获渲染异常:', e);
    this.setState((prev) => {
      const nextCount = prev.count + 1;
      if (nextCount <= 1) {
        setTimeout(() => this.setState({ failed: 0 }), 200);
      }
      return { count: nextCount };
    });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.count <= 1) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '12px', padding: '24px', color: '#e6edf3', background: '#101217', fontFamily: 'system-ui, sans-serif' }}>
        <b style={{ fontSize: '16px' }}>教师端画面加载遇到了一点小问题（课堂黑板与学生窗口不受影响）</b>
        <span style={{ fontSize: '13px', color: '#8b949e', maxWidth: '520px', textAlign: 'center' }}>{this.state.message || '可能是上次停留的预览文件已被移动或未授权。'}</span>
        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            onClick={() => {
              // 清理可能触发异常的本地预览项并重置阅读器为空白黑板，保留所有学生、课表与黑板笔迹数据
              const freshBoard = boardMaterial();
              useStore.getState().set({
                pvw: null,
                reader: { mat: freshBoard, view: defaultView(freshBoard), split: null },
                page: 'console',
              });
              this.setState({ failed: 0, count: 0, message: '' });
            }}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2f81f7', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            清理异常预览并立即恢复导播台
          </button>
        </div>
      </div>
    );
  }
}

function Root() {
  const skin = useStore((s) => s.skin);
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    broadcastTheme();
  }, [skin]);
  if (ROLE === 'dock') return <><Recover><DockApp/></Recover><Tooltips/></>;
  if (ROLE === 'student')
    return (
      <>
        <Recover><StudentApp /></Recover>
        <Tooltips />
      </>
    );
  return <TeacherRecover><TeacherApp /></TeacherRecover>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
