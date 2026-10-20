import { useEffect, useRef, useState } from 'react';
import { registerFrame, updateFrame, type Where } from './bridge';
import { pluginUrl } from './pluginStore';

// allow-same-origin 只是让插件用上自己 plugin://<id> 来源的 localStorage；它和导播台页面不同源，碰不到导播台
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads';
const ALLOW = "autoplay; fullscreen; clipboard-write; camera 'none'; microphone 'none'; geolocation 'none'";

/** 插件页面：独立来源的沙盒框架，和导播台只通过插件桥说话 */
export function PluginFrame({ id, entry, where, title, onClose, onResize, onToast, className }: {
  id: string; entry: string; where: Where; title: string; className?: string;
  onClose?: () => void; onResize?: (w: number, h: number) => void; onToast?: (text: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => pluginUrl(id, entry));
  useEffect(() => registerFrame(ref.current!, { where, onClose, onResize, onToast }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current) updateFrame(ref.current, { where, onClose, onResize, onToast }); }, [where, onClose, onResize, onToast]);
  return <iframe ref={ref} className={'plugin-frame ' + (className ?? '')} title={title} src={src} sandbox={SANDBOX} allow={ALLOW} referrerPolicy="no-referrer" />;
}
