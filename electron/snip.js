'use strict';
// 框选截屏：整屏截图铺满窗口，老师拖出一个矩形，把矩形（窗口坐标，CSS 像素）交回主进程裁剪
(()=>{
 const shot=document.getElementById('shot'),dim=document.getElementById('dim'),box=document.getElementById('box'),size=document.getElementById('size'),tip=document.getElementById('tip');
 const img=new URLSearchParams(location.search).get('img');if(img)shot.src=img;
 let start=null,rect=null;
 const show=r=>{box.style.display='block';box.style.left=r.x+'px';box.style.top=r.y+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';size.textContent=Math.round(r.width*devicePixelRatio)+' × '+Math.round(r.height*devicePixelRatio);dim.style.display='none';};
 addEventListener('pointerdown',e=>{if(e.button===2){window.snip.cancel();return;}if(e.button!==0)return;start={x:e.clientX,y:e.clientY};rect=null;tip.style.display='none';document.body.setPointerCapture?.(e.pointerId);});
 addEventListener('pointermove',e=>{if(!start)return;rect={x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(e.clientX-start.x),height:Math.abs(e.clientY-start.y)};show(rect);});
 addEventListener('pointerup',()=>{if(!start)return;start=null;if(!rect||rect.width<6||rect.height<6){box.style.display='none';dim.style.display='block';tip.style.display='block';return;}window.snip.done({...rect,viewW:innerWidth,viewH:innerHeight});});
 addEventListener('keydown',e=>{if(e.key==='Escape')window.snip.cancel();});
 addEventListener('contextmenu',e=>e.preventDefault());
})();
