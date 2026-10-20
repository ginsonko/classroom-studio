import { Component, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/app.css';
import { ROLE, useStore } from './lib/store';
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
  return <TeacherApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
