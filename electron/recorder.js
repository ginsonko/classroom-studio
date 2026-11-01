const api=window.classroom;
let active=null,pending=null;
function level(context,stream){const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);const data=new Uint8Array(analyser.fftSize);return()=>{analyser.getByteTimeDomainData(data);return Math.min(1,Math.sqrt(data.reduce((a,v)=>a+(v-128)**2,0)/data.length)/40);};}
function cleanup(s){clearInterval(s.timer);clearInterval(s.meter);s.streams.forEach(v=>v.getTracks().forEach(t=>{t.onended=null;t.stop();}));if(s.context&&s.context.state!=='closed')s.context.close().catch(()=>{});}
async function start({recordId,settings,synthetic}){
 if(active||pending)await stop({abort:true});
 const job={recordId,streams:[],context:null,timer:null,cancelled:false};pending=job;
 const check=()=>{if(job.cancelled||pending!==job)throw new Error('CANCELLED');};
 const acquire=async promise=>{const stream=await promise;job.streams.push(stream);if(job.cancelled){stream.getTracks().forEach(t=>t.stop());}check();return stream;};
 try{
  const context=new AudioContext();job.context=context;await context.resume();check();const mixed=context.createMediaStreamDestination();let video,micLevel=()=>0,systemLevel=()=>0;
  // 课后语音转写用的纯音频：左声道是老师的麦克风，右声道是系统声音（会议里学生的声音），分开了才分得清谁说的
  const merger=context.createChannelMerger(2),voiceOut=context.createMediaStreamDestination();merger.connect(voiceOut);let voiceSides=0;
  const toVoice=(node,side)=>{try{node.connect(merger,0,side);voiceSides++;}catch{}};
  if(synthetic){
   const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let t=0;
   const draw=()=>{ctx.fillStyle='#f7f8fc';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#245fcb';ctx.font='48px sans-serif';ctx.fillText('Classroom recording test · '+t++,80,150);ctx.fillRect(80+(t*4)%900,300,100,100);};draw();job.timer=setInterval(draw,100);
   video=canvas.captureStream(15);job.streams.push(video);
   for(const [frequency,gainValue] of [[440,.06],[880,.04]]){const oscillator=context.createOscillator(),gain=context.createGain();gain.gain.value=gainValue;oscillator.frequency.value=frequency;oscillator.connect(gain).connect(mixed);toVoice(gain,frequency===440?0:1);oscillator.start();}
  }else{
   video=await acquire(navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:20},audio:settings.systemAudio}));
   if(settings.systemAudio){if(!video.getAudioTracks().length)throw new Error('系统声音未捕获，请检查Windows声音输出设备');const audio=new MediaStream(video.getAudioTracks()),src=context.createMediaStreamSource(audio);src.connect(mixed);toVoice(src,1);systemLevel=level(context,audio);}
   if(settings.microphone){const mic=await acquire(navigator.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}));const src=context.createMediaStreamSource(mic);src.connect(mixed);toVoice(src,0);micLevel=level(context,mic);}
  }
  check();const hasAudio=synthetic||settings.systemAudio||settings.microphone;
  const stream=new MediaStream([...video.getVideoTracks(),...(hasAudio?mixed.stream.getAudioTracks():[])]);
  const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(v=>MediaRecorder.isTypeSupported(v));
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:settings.bitrate,audioBitsPerSecond:128000});
  const recordingSession={...job,recorder,pending:Promise.resolve(),seq:0,aborting:false};active=recordingSession;pending=null;
  recorder.ondataavailable=e=>{if(!e.data.size||recordingSession.aborting)return;recordingSession.pending=recordingSession.pending.then(async()=>{if(recordingSession.aborting)return;const bytes=await e.data.arrayBuffer();await api.call('recordChunk',{recordId,seq:recordingSession.seq++,bytes});}).catch(e=>api.call('recordError',{recordId,error:e.message}));};
  recorder.onerror=e=>api.call('recordError',{recordId,error:e.error?.message||'录制编码失败'});
  // 语音轨出任何问题都不影响录像本身：录不了就只是课后没有转写
  recordingSession.voiceDone=Promise.resolve();
  if(voiceSides&&settings.voiceTrack!==false)try{
   const vmime=['audio/webm;codecs=opus','audio/webm'].find(v=>MediaRecorder.isTypeSupported(v));
   const voice=new MediaRecorder(voiceOut.stream,{mimeType:vmime,audioBitsPerSecond:64000});let vseq=0,vpending=Promise.resolve(),vfailed=false;
   voice.ondataavailable=e=>{if(!e.data.size||recordingSession.aborting||vfailed)return;vpending=vpending.then(async()=>{const bytes=await e.data.arrayBuffer();await api.call('recordVoice',{recordId,seq:vseq++,bytes});}).catch(()=>{vfailed=true;});};
   recordingSession.voiceDone=new Promise(done=>{voice.onstop=()=>vpending.then(done,done);voice.onerror=()=>{vfailed=true;done();};});
   recordingSession.voice=voice;
  }catch{recordingSession.voice=null;}
  recorder.onstop=async()=>{try{if(recordingSession.voice&&recordingSession.voice.state!=='inactive')recordingSession.voice.stop();}catch{}await Promise.race([recordingSession.voiceDone,new Promise(r=>setTimeout(r,5000))]);await recordingSession.pending;cleanup(recordingSession);if(!recordingSession.aborting)await api.call('recordStopped',{recordId});if(active===recordingSession)active=null;};
  for(const source of job.streams){for(const track of source.getTracks()){track.onended=()=>{if(recorder.state!=='inactive')api.call('recordError',{recordId,error:track.kind==='audio'?'录音设备已断开，已保留录像，请检查音频设备':'学生窗口捕获已结束，已保留录像'});};}}
  recorder.start(2000);try{recordingSession.voice?.start(2000);}catch{recordingSession.voice=null;}recordingSession.meter=setInterval(()=>api.call('recordMeter',{recordId,micLevel:micLevel(),systemLevel:systemLevel()}).catch(()=>{}),700);
  await api.call('recordReady',{recordId,audio:{microphone:!synthetic&&settings.microphone,system:!synthetic&&settings.systemAudio,synthetic,tracks:stream.getAudioTracks().length,voice:!!recordingSession.voice}});
 }catch(e){cleanup(job);if(pending===job)pending=null;if(!job.cancelled&&e.message!=='CANCELLED')await api.call('recordError',{recordId,error:e.message});}
}
async function stop({recordId,abort=false}={}){
 if(pending&&(!recordId||recordId===pending.recordId)){const job=pending;job.cancelled=true;pending=null;cleanup(job);if(!abort)await api.call('recordStopped',{recordId:job.recordId});}
 if(!active||recordId&&recordId!==active.recordId)return;
 const s=active;s.aborting=abort;if(s.recorder.state!=='inactive')s.recorder.stop();else{cleanup(s);if(active===s)active=null;}
}
api.on(event=>{if(event.type==='record:start')start(event);if(event.type==='record:stop')stop({recordId:event.recordId});if(event.type==='record:abort')stop({recordId:event.recordId,abort:true});});
