'use strict';
// 搬自万能创作终端 0.7.0（electron/desk-helper.cjs），只改了提示里的软件名；要改行为先同步上游。
// 键鼠控制 · the Windows input helper: one long-lived PowerShell process that compiles a small C# class
// with Add-Type and speaks JSON lines over stdin/stdout. No native addon to rebuild per Electron version.
// Ported from Quicksilver's qs/hand/desk.py: every injected event carries a marker in dwExtraInfo, a
// low-level keyboard/mouse hook counts the events without it (the user, or other software) and stops the
// current action at once; keys held down are released on every exit path; all coordinates are physical
// pixels (per-monitor DPI aware threads).
const { spawn: nodeSpawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = String.raw`
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace OmniDesk {
public static class Host {
  // 'OMND': our own events; the hook ignores them.
  const long MAGIC = 0x4F4D4E44;

  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public int cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr h, int index, StringBuilder buf, int len, out int needed);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookExW(int id, HookProc proc, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetRect(IntPtr h, int attr, out RECT value, int size);
  [DllImport("user32.dll")] static extern int GetMessageW(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("user32.dll")] static extern bool PeekMessageW(out MSG m, IntPtr h, uint a, uint b, uint remove);
  [DllImport("user32.dll")] static extern bool PostThreadMessageW(uint tid, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, int flags, StringBuilder sb, ref int size);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int ret);

  static readonly object outLock = new object();
  static Stream stdout;
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static readonly BlockingCollection<Dictionary<string, object>> jobs = new BlockingCollection<Dictionary<string, object>>();
  static readonly BlockingCollection<string> signals = new BlockingCollection<string>();

  // Guard state. The hook callbacks only count and flag (Windows drops a slow low-level hook);
  // the decisions happen on the worker thread.
  static volatile bool guardOn, pauseOnInput, takeover;
  static volatile uint ownPid;
  static volatile int movePx = 12;
  static int graceUntil, selfMoveUntil;
  static bool rawExact = true;
  static RECT[] exclude = new RECT[0];
  static volatile int[][] corners;
  static double moved;
  static bool hasLast, ctrlDown, altDown;
  static POINT lastPt;
  static long abortUpTo, lastSeen;
  static Thread hookThread;
  static uint hookTid;
  static string hookError;
  static ManualResetEvent hookReady = new ManualResetEvent(false);
  static HookProc kbProc, msProc;
  static readonly HashSet<ushort> heldKeys = new HashSet<ushort>();
  static readonly HashSet<uint> heldButtons = new HashSet<uint>();

  class Stop : Exception { public string Why; public Stop(string why, string msg) : base(msg) { Why = why; } }

  static void Aware() {
    try { if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return; } catch (EntryPointNotFoundException) { }
    try { SetProcessDPIAware(); } catch { }
  }

  public static void Run() {
    Aware();
    stdout = Console.OpenStandardOutput();
    new Thread(Writer) { IsBackground = true, Name = "omni-desk-out" }.Start();
    var worker = new Thread(Work) { IsBackground = true, Name = "omni-desk-work" };
    worker.Start();
    var v = Virtual();
    var self = WindowInfoOfProcess((uint)System.Diagnostics.Process.GetCurrentProcess().Id);
    Emit(new Dictionary<string, object> { { "event", "ready" }, { "pid", System.Diagnostics.Process.GetCurrentProcess().Id }, { "virtual", v }, { "elevated", self["elevated"] } });
    var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    string line;
    while ((line = reader.ReadLine()) != null) {
      Dictionary<string, object> m;
      try { m = json.Deserialize<Dictionary<string, object>>(line); } catch (Exception e) { Emit(new Dictionary<string, object> { { "event", "bad" }, { "error", e.Message } }); continue; }
      if (m == null) continue;
      Interlocked.Exchange(ref lastSeen, (long)Num(m, "id", 0));
      // Stop requests skip the queue so they reach a command that is running.
      if (Str(m, "op") == "abort") {
        Interlocked.Exchange(ref abortUpTo, (long)Num(m, "upTo", 0));
        Reply(m, Ok());
        continue;
      }
      jobs.Add(m);
    }
    jobs.CompleteAdding();
    worker.Join(3000);
    ReleaseAll();
    GuardOff();
  }

  static void Writer() {
    foreach (var s in signals.GetConsumingEnumerable()) {
      var b = Encoding.UTF8.GetBytes(s + "\n");
      lock (outLock) { stdout.Write(b, 0, b.Length); stdout.Flush(); }
    }
  }

  static void Emit(Dictionary<string, object> d) { signals.Add(json.Serialize(d)); }

  static void Reply(Dictionary<string, object> req, Dictionary<string, object> res) {
    res["id"] = req.ContainsKey("id") ? req["id"] : null;
    Emit(res);
  }

  static Dictionary<string, object> Ok() { return new Dictionary<string, object> { { "ok", true } }; }

  static void Work() {
    Aware();
    foreach (var m in jobs.GetConsumingEnumerable()) {
      Dictionary<string, object> r;
      try {
        r = Do(m);
      } catch (Stop s) {
        ReleaseAll();
        r = new Dictionary<string, object> { { "ok", false }, { "stopped", s.Why }, { "error", s.Message } };
      } catch (Exception e) {
        ReleaseAll();
        r = new Dictionary<string, object> { { "ok", false }, { "error", e.Message } };
      }
      Reply(m, r);
    }
  }

  // ---------------------------------------------------------------- arguments

  static string Str(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : ""; }
  static double Num(Dictionary<string, object> m, string k, double dflt) { object v; return m.TryGetValue(k, out v) && v != null ? Convert.ToDouble(v) : dflt; }
  static bool Bool(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v is bool && (bool)v; }
  static IList List(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) ? v as IList : null; }

  // ---------------------------------------------------------------- commands

  static Dictionary<string, object> Do(Dictionary<string, object> m) {
    string op = Str(m, "op");
    long id = (long)Num(m, "id", 0);
    switch (op) {
      case "ping": { var r = Ok(); r["virtual"] = Virtual(); return r; }
      case "guard": return Guard(m);
      case "reset": ResetGuard(); return Ok();
      case "release": ReleaseAll(); return Ok();
      case "probe": return Probe(m);
      case "windows": return Windows();
      case "cursor": { POINT p; GetCursorPos(out p); var r = Ok(); r["cursor"] = new int[] { p.x, p.y }; return r; }
    }
    Check(id, true);
    switch (op) {
      case "move": MoveTo(id, (int)Num(m, "x", 0), (int)Num(m, "y", 0), Bool(m, "glide")); break;
      case "click": Click(id, m); break;
      case "drag": Drag(id, m); break;
      case "scroll": Scroll(id, m); break;
      case "type": TypeText(id, Str(m, "text"), (long)Num(m, "hwnd", 0), (int)Num(m, "delay", 8)); break;
      case "key": Keys(id, m); break;
      case "activate": return Activate(id, m);
      case "paste_files": return PasteFiles(id, m);
      default: throw new Exception("unknown op " + op);
    }
    POINT c; GetCursorPos(out c);
    var res = Ok();
    res["cursor"] = new int[] { c.x, c.y };
    // false when SendInput's normalized coordinates missed and SetCursorPos had to correct the last move.
    res["exact"] = rawExact;
    return res;
  }

  static int[] Virtual() {
    return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
  }

  /** Throws when this command must not go on: stopped from the app, the user took over, the secure desktop. */
  static void Check(long id, bool desktop) {
    if (Interlocked.Read(ref abortUpTo) >= id) throw new Stop("abort", "stopped");
    if (guardOn && pauseOnInput && takeover) throw new Stop("user", "the user took over the keyboard or mouse");
    if (guardOn && hookError != null) throw new Stop("guard", hookError);
    if (desktop && InputDesktop() != "Default") throw new Stop("secure", "secure desktop");
  }

  static string InputDesktop() {
    IntPtr h = OpenInputDesktop(0, false, 0x0001);
    if (h == IntPtr.Zero) return "";
    try {
      var sb = new StringBuilder(256);
      int need;
      return GetUserObjectInformationW(h, 2, sb, sb.Capacity * 2, out need) ? sb.ToString() : "";
    } finally { CloseDesktop(h); }
  }

  static void Send(INPUT[] ev) {
    uint n = SendInput((uint)ev.Length, ev, Marshal.SizeOf(typeof(INPUT)));
    if (n != ev.Length) throw new Exception("SendInput blocked (" + Marshal.GetLastWin32Error() + ")");
  }

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var i = new INPUT { type = 1 };
    i.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags, dwExtraInfo = new IntPtr(MAGIC) };
    return i;
  }

  static INPUT Mouse(int dx, int dy, uint data, uint flags) {
    var i = new INPUT { type = 0 };
    i.u.mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags, dwExtraInfo = new IntPtr(MAGIC) };
    return i;
  }

  static void MoveRaw(int x, int y) {
    var v = Virtual();
    int vw = Math.Max(1, v[2]), vh = Math.Max(1, v[3]);
    // Round up so the pixel Windows maps the normalized value back to is exactly (x, y).
    int ax = (int)(((long)(x - v[0]) * 65536 + vw - 1) / vw);
    int ay = (int)(((long)(y - v[1]) * 65536 + vh - 1) / vh);
    Send(new[] { Mouse(ax, ay, 0, 0x0001 | 0x8000 | 0x4000) });
  }

  static void MoveTo(long id, int x, int y, bool glide) {
    if (glide) Glide(id, x, y);
    MoveRaw(x, y);
    POINT p; GetCursorPos(out p);
    rawExact = p.x == x && p.y == y;
    if (!rawExact) {
      selfMoveUntil = Environment.TickCount + 60;
      SetCursorPos(x, y);
    }
  }

  // Ported from Quicksilver's glide: a minimum-jerk speed curve, duration growing with distance like
  // Fitts' law, so the user sees where the pointer goes and can stop it half way. No random bow here.
  static void Glide(long id, int x, int y) {
    POINT s; GetCursorPos(out s);
    double dx = x - s.x, dy = y - s.y, dist = Math.Sqrt(dx * dx + dy * dy);
    if (dist < 3) return;
    double dur = Math.Min(0.6, 0.12 + 0.08 * Math.Log(1 + dist / 40, 2));
    int steps = Math.Max(6, (int)(dur * 90));
    var clock = System.Diagnostics.Stopwatch.StartNew();
    for (int i = 1; i <= steps; i++) {
      Check(id, false);
      double t = (double)i / steps, e = t * t * t * (10 - 15 * t + 6 * t * t);
      MoveRaw((int)Math.Round(s.x + dx * e), (int)Math.Round(s.y + dy * e));
      int lag = (int)(dur * 1000 * t - clock.ElapsedMilliseconds);
      if (lag > 0) Thread.Sleep(lag);
    }
  }

  static uint[] ButtonFlags(string b) {
    if (b == "right") return new uint[] { 0x0008, 0x0010 };
    if (b == "middle") return new uint[] { 0x0020, 0x0040 };
    return new uint[] { 0x0002, 0x0004 };
  }

  static void Press(uint down) { Send(new[] { Mouse(0, 0, 0, down) }); lock (heldButtons) heldButtons.Add(down); }
  static void Lift(uint down, uint up) { Send(new[] { Mouse(0, 0, 0, up) }); lock (heldButtons) heldButtons.Remove(down); }

  static void Click(long id, Dictionary<string, object> m) {
    int x = (int)Num(m, "x", 0), y = (int)Num(m, "y", 0);
    long hwnd = (long)Num(m, "hwnd", 0);
    if (hwnd == 0) throw new Stop("target", "a verified target window is required");
    CheckClickTarget(x, y, hwnd);
    var f = ButtonFlags(Str(m, "button"));
    MoveTo(id, x, y, Bool(m, "glide"));
    int count = Math.Max(1, Math.Min(3, (int)Num(m, "count", 1)));
    for (int i = 0; i < count; i++) {
      Check(id, true);
      Thread.Sleep(i == 0 ? 30 : 50);
      Check(id, true);
      CheckClickTarget(x, y, hwnd);
      Press(f[0]);
      Thread.Sleep(30);
      Lift(f[0], f[1]);
    }
  }

  static void CheckClickTarget(int x, int y, long hwnd) {
    IntPtr at = WindowFromPoint(new POINT { x = x, y = y });
    if (at == IntPtr.Zero || GetAncestor(at, 2).ToInt64() != hwnd)
      throw new Stop("target", "the window under the pointer changed");
  }

  static void Drag(long id, Dictionary<string, object> m) {
    var f = ButtonFlags(Str(m, "button"));
    MoveTo(id, (int)Num(m, "x1", 0), (int)Num(m, "y1", 0), true);
    Thread.Sleep(40);
    Press(f[0]);
    try {
      Thread.Sleep(80);
      MoveRaw((int)Num(m, "x1", 0) + 4, (int)Num(m, "y1", 0) + 4);
      MoveTo(id, (int)Num(m, "x2", 0), (int)Num(m, "y2", 0), true);
      Thread.Sleep(80);
    } finally { Lift(f[0], f[1]); }
  }

  static void Scroll(long id, Dictionary<string, object> m) {
    if (m.ContainsKey("x")) MoveTo(id, (int)Num(m, "x", 0), (int)Num(m, "y", 0), false);
    int dy = (int)Num(m, "dy", 0), dx = (int)Num(m, "dx", 0);
    int n = Math.Min(30, Math.Abs(dy) + Math.Abs(dx));
    for (int i = 0; i < n; i++) {
      Check(id, true);
      if (i < Math.Abs(dy)) Send(new[] { Mouse(0, 0, unchecked((uint)(dy > 0 ? 120 : -120)), 0x0800) });
      else Send(new[] { Mouse(0, 0, unchecked((uint)(dx > 0 ? 120 : -120)), 0x1000) });
      Thread.Sleep(40);
    }
  }

  static void Focus(long hwnd) {
    if (hwnd != 0 && GetForegroundWindow().ToInt64() != hwnd) throw new Stop("focus", "the foreground window changed");
  }

  static void TypeText(long id, string text, long hwnd, int delay) {
    delay = Math.Max(0, Math.Min(200, delay));
    for (int i = 0; i < text.Length; i++) {
      Check(id, i % 16 == 0);
      Focus(hwnd);
      char c = text[i];
      if (c == '\r') continue;
      if (c == '\n' || c == '\t') {
        ushort vk = (ushort)(c == '\n' ? 0x0D : 0x09);
        Send(new[] { Key(vk, 0, 0), Key(vk, 0, 0x0002) });
      } else {
        Send(new[] { Key(0, c, 0x0004), Key(0, c, 0x0004 | 0x0002) });
      }
      if (delay > 0) Thread.Sleep(delay);
    }
  }

  static readonly HashSet<int> Extended = new HashSet<int> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0xA3, 0xA5, 0xAD, 0xAE, 0xAF };

  static void KeyDown(ushort vk) { Send(new[] { Key(vk, 0, Extended.Contains(vk) ? 0x0001u : 0u) }); lock (heldKeys) heldKeys.Add(vk); }
  static void KeyUp(ushort vk) { Send(new[] { Key(vk, 0, 0x0002u | (Extended.Contains(vk) ? 0x0001u : 0u)) }); lock (heldKeys) heldKeys.Remove(vk); }

  static void Keys(long id, Dictionary<string, object> m) {
    var list = List(m, "vks");
    if (list == null || list.Count == 0) throw new Exception("no keys");
    var vks = new List<ushort>();
    foreach (var o in list) vks.Add((ushort)Convert.ToInt32(o));
    int repeat = Math.Max(1, Math.Min(20, (int)Num(m, "repeat", 1)));
    long hwnd = (long)Num(m, "hwnd", 0);
    for (int r = 0; r < repeat; r++) {
      Check(id, true);
      Focus(hwnd);
      try {
        foreach (var vk in vks) KeyDown(vk);
        Thread.Sleep(30);
      } finally {
        for (int i = vks.Count - 1; i >= 0; i--) { try { KeyUp(vks[i]); } catch { } }
      }
      Thread.Sleep(40);
    }
  }

  /** Every exit path lets go of what it pressed. */
  static void ReleaseAll() {
    ushort[] keys; lock (heldKeys) { keys = new ushort[heldKeys.Count]; heldKeys.CopyTo(keys); }
    foreach (var k in keys) { try { KeyUp(k); } catch { } }
    uint[] buttons; lock (heldButtons) { buttons = new uint[heldButtons.Count]; heldButtons.CopyTo(buttons); }
    foreach (var b in buttons) { try { Lift(b, b << 1); } catch { } }
  }

  // ---------------------------------------------------------------- clipboard (paste files)

  [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr h);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint f);
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint f);
  [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint f, IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetOpenClipboardWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormatW(string name);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClipboardFormatNameW(uint f, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjects(uint n, IntPtr[] handles, bool all, uint ms, uint mask);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr result);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
  [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr h);
  [DllImport("gdi32.dll")] static extern uint GetEnhMetaFileBits(IntPtr h, uint size, byte[] buf);
  [DllImport("gdi32.dll")] static extern IntPtr SetEnhMetaFileBits(uint size, byte[] buf);
  [DllImport("gdi32.dll")] static extern bool DeleteEnhMetaFile(IntPtr h);

  const uint CF_HDROP = 15, CF_ENHMETAFILE = 14;
  // Windows calls a window that has not taken messages for 5 seconds "not responding" (IsHungAppWindow): a program
  // that reads the clipboard on Ctrl+V has done it by then, and one holding the clipboard open longer is stuck.
  const int HUNG_MS = 5000;
  // One tick of the default Windows timer (15.6 ms): the wait between tries to open a clipboard another program has open.
  const int TICK_MS = 16;

  public class ClipItem { public uint Format; public byte[] Data; public bool Emf; }

  /**
   * How a clipboard format comes back: "data" (global memory, copied byte for byte), "emf" (an enhanced metafile, by
   * its bits), "synth" (a GDI handle Windows makes again from a format that is copied) or "lost" (a handle only the
   * program that put it there understands).
   */
  public static string KindOf(uint f, ICollection<uint> present) {
    if (f == CF_ENHMETAFILE) return "emf";
    // CF_BITMAP and CF_PALETTE come from CF_DIB / CF_DIBV5, CF_METAFILEPICT from CF_ENHMETAFILE.
    if (f == 2 || f == 9) return present.Contains(8) || present.Contains(17) ? "synth" : "lost";
    if (f == 3) return present.Contains(CF_ENHMETAFILE) ? "synth" : "lost";
    // CF_OWNERDISPLAY, CF_DSPBITMAP, CF_DSPMETAFILEPICT, CF_DSPENHMETAFILE, CF_PRIVATEFIRST..CF_GDIOBJLAST.
    if (f == 0x80 || f == 0x82 || f == 0x83 || f == 0x8E || (f >= 0x200 && f <= 0x3FF)) return "lost";
    return "data";
  }

  /** CF_HDROP: a DROPFILES header (names at byte 20, wide), each full path NUL-ended, one more NUL at the end. */
  public static byte[] DropFiles(string[] paths) {
    var sb = new StringBuilder();
    foreach (var p in paths) sb.Append(p).Append('\0');
    sb.Append('\0');
    var names = Encoding.Unicode.GetBytes(sb.ToString());
    var b = new byte[20 + names.Length];
    BitConverter.GetBytes(20).CopyTo(b, 0);
    BitConverter.GetBytes(1).CopyTo(b, 16);
    names.CopyTo(b, 20);
    return b;
  }

  /** Whether the clipboard read back is what was saved: same formats in the same order, same bytes. */
  public static bool SameItems(IList<ClipItem> was, IList<ClipItem> now) {
    if (was.Count != now.Count) return false;
    for (int i = 0; i < was.Count; i++) {
      ClipItem a = was[i], b = now[i];
      if (a.Format != b.Format || a.Emf != b.Emf || b.Data.Length < a.Data.Length) return false;
      for (int j = 0; j < a.Data.Length; j++) if (a.Data[j] != b.Data[j]) return false;
      // GlobalAlloc may round a block up; the spare bytes are zeroed (GMEM_ZEROINIT) and were never anyone's data.
      for (int j = a.Data.Length; j < b.Data.Length; j++) if (b.Data[j] != 0) return false;
    }
    return true;
  }

  /** Everything on the clipboard (open), in its order; formats that cannot be copied back are named in lost. */
  static List<ClipItem> Snapshot(List<string> lost) {
    var formats = new List<uint>();
    for (uint f = EnumClipboardFormats(0); f != 0; f = EnumClipboardFormats(f)) formats.Add(f);
    var items = new List<ClipItem>();
    foreach (var f in formats) {
      string kind = KindOf(f, formats);
      if (kind == "synth") continue;
      byte[] data = kind == "lost" ? null : kind == "emf" ? EmfBits(GetClipboardData(f)) : GlobalBytes(GetClipboardData(f));
      if (data == null) { lost.Add(FormatName(f)); continue; }
      items.Add(new ClipItem { Format = f, Data = data, Emf = kind == "emf" });
    }
    return items;
  }

  static string FormatName(uint f) {
    var sb = new StringBuilder(256);
    return GetClipboardFormatNameW(f, sb, 256) > 0 ? sb.ToString() : "#" + f;
  }

  static byte[] GlobalBytes(IntPtr h) {
    if (h == IntPtr.Zero) return null;
    long n = (long)GlobalSize(h).ToUInt64();
    if (n <= 0) return null;
    IntPtr p = GlobalLock(h);
    if (p == IntPtr.Zero) return null;
    try { var b = new byte[n]; Marshal.Copy(p, b, 0, (int)n); return b; } finally { GlobalUnlock(h); }
  }

  static byte[] EmfBits(IntPtr h) {
    if (h == IntPtr.Zero) return null;
    uint n = GetEnhMetaFileBits(h, 0, null);
    if (n == 0) return null;
    var b = new byte[n];
    return GetEnhMetaFileBits(h, n, b) == n ? b : null;
  }

  /** Onto the clipboard (open, owned by us); false when Windows did not take it. */
  static bool PutBytes(uint f, byte[] b) {
    IntPtr g = GlobalAlloc(0x0042, new UIntPtr((ulong)b.Length));
    if (g == IntPtr.Zero) return false;
    IntPtr p = GlobalLock(g);
    if (p == IntPtr.Zero) { GlobalFree(g); return false; }
    Marshal.Copy(b, 0, p, b.Length);
    GlobalUnlock(g);
    if (SetClipboardData(f, g) != IntPtr.Zero) return true;
    GlobalFree(g);
    return false;
  }

  static bool Put(ClipItem it) {
    if (!it.Emf) return PutBytes(it.Format, it.Data);
    IntPtr e = SetEnhMetaFileBits((uint)it.Data.Length, it.Data);
    if (e == IntPtr.Zero) return false;
    if (SetClipboardData(it.Format, e) != IntPtr.Zero) return true;
    DeleteEnhMetaFile(e);
    return false;
  }

  static void Pump() {
    MSG msg;
    while (PeekMessageW(out msg, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref msg); DispatchMessageW(ref msg); }
  }

  /** Answers messages (programs asking for the file list) until done() says so or ms is up. */
  static bool WaitMessages(Func<bool> done, int ms) {
    var clock = System.Diagnostics.Stopwatch.StartNew();
    while (true) {
      Pump();
      if (done()) return true;
      long left = ms - clock.ElapsedMilliseconds;
      if (left <= 0) return false;
      MsgWaitForMultipleObjects(0, null, false, (uint)left, 0x04FF);
    }
  }

  static bool OpenWait(IntPtr h) {
    var clock = System.Diagnostics.Stopwatch.StartNew();
    while (!OpenClipboard(h)) {
      if (clock.ElapsedMilliseconds >= HUNG_MS) return false;
      Pump();
      Thread.Sleep(TICK_MS);
    }
    return true;
  }

  /** The clipboard owner while the files are on it: renders the file list when a program asks and notes who asked. */
  class ClipWin : System.Windows.Forms.NativeWindow {
    public byte[] Drop;
    public uint TargetPid;
    public bool TargetRead;
    public int OtherReads;
    public ClipWin() {
      var cp = new System.Windows.Forms.CreateParams();
      cp.Parent = new IntPtr(-3);
      CreateHandle(cp);
    }
    protected override void WndProc(ref System.Windows.Forms.Message m) {
      // WM_RENDERFORMAT: the window that opened the clipboard is the reader, so the paste is known to have read it.
      if (m.Msg == 0x0305 && (uint)m.WParam.ToInt64() == CF_HDROP && Drop != null) {
        uint pid = 0;
        IntPtr opener = GetOpenClipboardWindow();
        if (opener != IntPtr.Zero) GetWindowThreadProcessId(opener, out pid);
        if (pid != 0 && pid == TargetPid) TargetRead = true; else OtherReads++;
        PutBytes(CF_HDROP, Drop);
        m.Result = IntPtr.Zero;
        return;
      }
      // WM_RENDERALLFORMATS: the owner's content goes back before this window does, nothing is left to render.
      if (m.Msg == 0x0306) { m.Result = IntPtr.Zero; return; }
      base.WndProc(ref m);
    }
  }

  static Dictionary<string, object> PasteFiles(long id, Dictionary<string, object> m) {
    var list = List(m, "paths");
    if (list == null || list.Count == 0) throw new Exception("no files");
    var paths = new List<string>();
    foreach (var o in list) paths.Add(Convert.ToString(o));
    long hwnd = (long)Num(m, "hwnd", 0);
    Dictionary<string, object> res = null;
    Exception err = null;
    // A thread of its own with a message queue: programs asking for the file list are answered while it waits.
    var t = new Thread(() => { try { Aware(); res = PasteOn(id, paths.ToArray(), hwnd); } catch (Exception e) { err = e; } }) { IsBackground = true, Name = "omni-desk-clip" };
    t.SetApartmentState(ApartmentState.STA);
    t.Start();
    t.Join();
    if (err != null) throw err;
    return res;
  }

  /**
   * Saves the owner's clipboard, puts the files there (the list rendered on demand), presses Ctrl+V in hwnd, waits
   * until that program has read the list, then puts the owner's clipboard back and reads it again to check.
   * Nothing is changed when something on the clipboard could not be put back. Never throws once the files are there:
   * the reply says whether the clipboard went back (restored) either way.
   */
  static Dictionary<string, object> PasteOn(long id, string[] paths, long hwnd) {
    var r = Ok();
    r["placed"] = false;
    var win = new ClipWin();
    try {
      Check(id, true);
      Focus(hwnd);
      uint pid;
      GetWindowThreadProcessId(new IntPtr(hwnd), out pid);
      win.TargetPid = pid;
      win.Drop = DropFiles(paths);
      var lost = new List<string>();
      List<ClipItem> saved;
      if (!OpenWait(win.Handle)) throw new Exception("clipboard busy");
      try { saved = Snapshot(lost); } finally { CloseClipboard(); }
      r["formats"] = saved.Count;
      if (lost.Count > 0) {
        r["ok"] = false;
        r["error"] = "unsaveable";
        r["lost"] = lost;
        return r;
      }
      try {
        if (!OpenWait(win.Handle)) throw new Exception("clipboard busy");
        try {
          EmptyClipboard();
          r["placed"] = true;
          // Rendered on demand (WM_RENDERFORMAT), so the reply knows whether the target program read it.
          SetClipboardData(CF_HDROP, IntPtr.Zero);
          // DROPEFFECT_COPY: pasted into a folder the files are copied, never moved.
          PutBytes(RegisterClipboardFormatW("Preferred DropEffect"), BitConverter.GetBytes(1));
          // Documented clipboard formats that keep this list out of clipboard monitors, the Win+V history and the cloud clipboard.
          PutBytes(RegisterClipboardFormatW("ExcludeClipboardContentFromMonitorProcessing"), BitConverter.GetBytes(0));
          PutBytes(RegisterClipboardFormatW("CanIncludeInClipboardHistory"), BitConverter.GetBytes(0));
          PutBytes(RegisterClipboardFormatW("CanUploadToCloudClipboard"), BitConverter.GetBytes(0));
        } finally { CloseClipboard(); }
        Check(id, true);
        Focus(hwnd);
        try {
          KeyDown(0x11);
          KeyDown(0x56);
          Thread.Sleep(30);
        } finally {
          try { KeyUp(0x56); } catch { }
          try { KeyUp(0x11); } catch { }
        }
        WaitMessages(() => win.TargetRead, HUNG_MS);
        // It has read the list: let it finish handling the paste before the clipboard changes under it.
        if (win.TargetRead) { IntPtr x; SendMessageTimeoutW(new IntPtr(hwnd), 0, IntPtr.Zero, IntPtr.Zero, 0x0002, (uint)HUNG_MS, out x); }
        r["read"] = win.TargetRead;
        r["others"] = win.OtherReads;
      } catch (Stop s) {
        ReleaseAll();
        r["ok"] = false;
        r["stopped"] = s.Why;
        r["error"] = s.Message;
      } catch (Exception e) {
        ReleaseAll();
        r["ok"] = false;
        r["error"] = e.Message;
      } finally {
        if ((bool)r["placed"]) Restore(win, saved, r);
      }
    } catch (Stop s) {
      r["ok"] = false;
      r["stopped"] = s.Why;
      r["error"] = s.Message;
    } finally {
      win.DestroyHandle();
    }
    return r;
  }

  static void Restore(ClipWin win, List<ClipItem> saved, Dictionary<string, object> r) {
    bool put = false, same = false;
    if (OpenWait(win.Handle)) {
      try {
        put = EmptyClipboard();
        foreach (var it in saved) put &= Put(it);
      } finally { CloseClipboard(); }
    }
    win.Drop = null;
    if (put && OpenWait(win.Handle)) {
      var lost = new List<string>();
      try { same = SameItems(saved, Snapshot(lost)) && lost.Count == 0; } finally { CloseClipboard(); }
    }
    r["restored"] = same;
    if (!same && !r.ContainsKey("error")) r["error"] = put ? "the clipboard read back differs" : "clipboard busy";
  }

  // ---------------------------------------------------------------- windows

  static Dictionary<string, object> WindowInfo(IntPtr h) {
    if (h == IntPtr.Zero) return null;
    var title = new StringBuilder(512); GetWindowTextW(h, title, 512);
    var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
    uint pid; GetWindowThreadProcessId(h, out pid);
    RECT r; GetWindowRect(h, out r);
    var d = WindowInfoOfProcess(pid);
    d["hwnd"] = h.ToInt64();
    d["title"] = title.ToString();
    d["cls"] = cls.ToString();
    d["rect"] = new int[] { r.left, r.top, r.right, r.bottom };
    d["passive"] = Passive(h);
    return d;
  }

  /** The same reading as sense-helper's Passive / Front (the two helpers must agree on the window in front). */
  public static bool Passive(IntPtr h) {
    int ex = GetWindowLong(h, -20);
    if ((ex & 0x08000000) != 0) return true;
    if ((ex & 0x80) == 0) return false;
    uint pid; uint tid = GetWindowThreadProcessId(h, out pid);
    var gi = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
    return !(tid != 0 && GetGUIThreadInfo(tid, ref gi) && gi.hwndFocus != IntPtr.Zero && (gi.hwndFocus == h || IsChild(h, gi.hwndFocus)));
  }

  public static IntPtr Front(IntPtr h, uint own) {
    if (h == IntPtr.Zero || !Passive(h)) return h;
    for (IntPtr w = GetWindow(h, 2); w != IntPtr.Zero; w = GetWindow(w, 2)) {
      if (!IsWindowVisible(w) || IsIconic(w) || GetWindowTextLengthW(w) == 0 || Passive(w)) continue;
      uint pid; GetWindowThreadProcessId(w, out pid);
      if (own != 0 && pid == own) continue;
      int cloaked = 0;
      try { if (DwmGetWindowAttribute(w, 14, out cloaked, 4) == 0 && cloaked != 0) continue; } catch { }
      return w;
    }
    return h;
  }

  static Dictionary<string, object> WindowInfoOfProcess(uint pid) {
    var d = new Dictionary<string, object> { { "pid", (long)pid } };
    d["exe"] = "";
    d["elevated"] = null;
    IntPtr ph = OpenProcess(0x1000, false, pid);
    if (ph != IntPtr.Zero) {
      try {
        var sb = new StringBuilder(1024); int size = sb.Capacity;
        if (QueryFullProcessImageNameW(ph, 0, sb, ref size)) d["exe"] = Path.GetFileName(sb.ToString()).ToLowerInvariant();
      } finally { CloseHandle(ph); }
    }
    // Reading the token needs full query rights, which Windows refuses for processes running at a higher
    // integrity level (administrator, system). elevated stays null then: treated as "not ours to drive".
    IntPtr pq = OpenProcess(0x0400, false, pid);
    if (pq != IntPtr.Zero) {
      try {
        IntPtr tok;
        if (OpenProcessToken(pq, 0x0008, out tok)) {
          try { int elev, ret; if (GetTokenInformation(tok, 20, out elev, 4, out ret)) d["elevated"] = elev != 0; } finally { CloseHandle(tok); }
        }
      } finally { CloseHandle(pq); }
    }
    return d;
  }

  /** Visible, not minimized, not cloaked top-level windows, topmost first (EnumWindows walks the z-order). */
  static Dictionary<string, object> Windows() {
    var list = new List<object>();
    var exes = new Dictionary<uint, string>();
    EnumWindows((h, l) => {
      if (list.Count >= 400) return false;
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int cloaked = 0;
      try { if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; } catch { }
      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      // The visible frame: GetWindowRect includes invisible resize borders that reach onto the next screen.
      RECT f;
      try { if (DwmGetRect(h, 9, out f, Marshal.SizeOf(typeof(RECT))) == 0 && f.right > f.left && f.bottom > f.top) r = f; } catch { }
      if (r.right <= r.left || r.bottom <= r.top) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string exe;
      if (!exes.TryGetValue(pid, out exe)) { exe = ExeOf(pid); exes[pid] = exe; }
      var title = new StringBuilder(512); GetWindowTextW(h, title, 512);
      var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
      int ex = GetWindowLong(h, -20);
      list.Add(new Dictionary<string, object> {
        { "hwnd", h.ToInt64() }, { "title", title.ToString() }, { "cls", cls.ToString() }, { "pid", (long)pid }, { "exe", exe },
        { "rect", new int[] { r.left, r.top, r.right, r.bottom } },
        // Layered or click-through windows (overlays) may be see-through: they never hide what is under them.
        { "opaque", (ex & 0x80020) == 0 }, { "passive", Passive(h) },
      });
      return true;
    }, IntPtr.Zero);
    var res = Ok();
    res["windows"] = list;
    return res;
  }

  static string ExeOf(uint pid) {
    IntPtr ph = OpenProcess(0x1000, false, pid);
    if (ph == IntPtr.Zero) return "";
    try {
      var sb = new StringBuilder(1024); int size = sb.Capacity;
      return QueryFullProcessImageNameW(ph, 0, sb, ref size) ? Path.GetFileName(sb.ToString()).ToLowerInvariant() : "";
    } finally { CloseHandle(ph); }
  }

  /**
   * Bring a window to the foreground by the book (learn.microsoft.com SetForegroundWindow, Remarks): a process may
   * set it only when "the calling process received the last input event", so first one input that changes nothing
   * (a mouse move to where the cursor already is), then SetForegroundWindow. Where Windows still says no, the
   * AttachThreadInput route (learn.microsoft.com AttachThreadInput: attached threads share their input state) is
   * the second way. GetForegroundWindow afterwards is the only judge: ok false means Windows kept it behind.
   * The target is the topmost window whose title matches, never one of ours (ownPid): the pet's bubble and cards
   * often quote the very title she asked for.
   */
  static Dictionary<string, object> Activate(long id, Dictionary<string, object> m) {
    long hwnd = (long)Num(m, "hwnd", 0);
    string want = Str(m, "title").ToLowerInvariant();
    uint own = (uint)Num(m, "ownPid", 0);
    IntPtr target = IntPtr.Zero;
    string title = "";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (own != 0 && pid == own) return true;
      int cloaked = 0;
      try { if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; } catch { }
      var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512);
      if (hwnd != 0 ? h.ToInt64() == hwnd : (want != "" && sb.ToString().ToLowerInvariant().Contains(want))) { target = h; title = sb.ToString(); return false; }
      return true;
    }, IntPtr.Zero);
    if (target == IntPtr.Zero) throw new Exception("no window titled " + Str(m, "title"));
    if (IsIconic(target)) ShowWindow(target, 9); // SW_RESTORE
    string way = "already";
    if (GetForegroundWindow() != target) {
      way = "input";
      Check(id, true);
      POINT c; GetCursorPos(out c);
      // The hook ignores this move (MAGIC), so it is never read as the owner taking the mouse.
      uint sent = (uint)Environment.TickCount;
      MoveRaw(c.x, c.y);
      // SendInput only queues the event: SetForegroundWindow is asked once Windows has taken it in, which
      // GetLastInputInfo shows (its time reaches the moment it was sent).
      var clock = System.Diagnostics.Stopwatch.StartNew();
      var li = new LASTINPUTINFO { cbSize = Marshal.SizeOf(typeof(LASTINPUTINFO)) };
      while (GetLastInputInfo(ref li) && (int)(li.dwTime - sent) < 0 && clock.ElapsedMilliseconds < HUNG_MS) Thread.Sleep(TICK_MS);
      SetForegroundWindow(target);
      if (GetForegroundWindow() != target) {
        way = "attach";
        uint fgPid, tgtPid;
        uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
        uint self = GetCurrentThreadId();
        uint tgtTid = GetWindowThreadProcessId(target, out tgtPid);
        bool a1 = false, a2 = false;
        try {
          if (fgTid != 0 && fgTid != self) a1 = AttachThreadInput(self, fgTid, true);
          if (tgtTid != 0 && tgtTid != self && tgtTid != fgTid) a2 = AttachThreadInput(self, tgtTid, true);
          BringWindowToTop(target);
          SetForegroundWindow(target);
        } finally {
          if (a1) AttachThreadInput(self, fgTid, false);
          if (a2) AttachThreadInput(self, tgtTid, false);
        }
      }
    }
    var fg = GetForegroundWindow();
    var r = new Dictionary<string, object> { { "ok", fg == target } };
    r["title"] = title;
    r["way"] = way;
    r["fg"] = WindowInfo(fg);
    if (fg != target) r["error"] = "Windows kept the window behind (foreground lock)";
    return r;
  }

  static Dictionary<string, object> Probe(Dictionary<string, object> m) {
    var r = Ok();
    r["desktop"] = InputDesktop();
    IntPtr raw = GetForegroundWindow();
    IntPtr fg = Front(raw, (uint)Num(m, "own", 0));
    r["fg"] = WindowInfo(fg);
    // In front but not worked in (an IME's status bar): keys sent now would go to it, not to fg.
    if (fg != raw) r["passive"] = WindowInfo(raw);
    if (m.ContainsKey("x")) {
      var pt = new POINT { x = (int)Num(m, "x", 0), y = (int)Num(m, "y", 0) };
      IntPtr at = WindowFromPoint(pt);
      r["at"] = WindowInfo(at == IntPtr.Zero ? at : GetAncestor(at, 2));
    }
    POINT c; GetCursorPos(out c);
    r["cursor"] = new int[] { c.x, c.y };
    r["virtual"] = Virtual();
    if (Bool(m, "focus")) {
      object pw = null;
      uint pid, tid = GetWindowThreadProcessId(fg, out pid);
      var gi = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
      if (tid != 0 && GetGUIThreadInfo(tid, ref gi) && gi.hwndFocus != IntPtr.Zero) {
        var cls = new StringBuilder(256); GetClassNameW(gi.hwndFocus, cls, 256);
        r["focusCls"] = cls.ToString();
        if (cls.ToString().IndexOf("edit", StringComparison.OrdinalIgnoreCase) >= 0 && (GetWindowLong(gi.hwndFocus, -16) & 0x20) != 0) pw = true;
      }
      if (pw == null) pw = UiaPassword(1500);
      r["password"] = pw;
    }
    return r;
  }

  /** UI Automation's IsPassword of the focused element (browsers, WPF, UWP); null when it cannot tell in time. */
  static object UiaPassword(int ms) {
    object result = null;
    var t = new Thread(() => {
      try {
        var asm = Assembly.Load("UIAutomationClient, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35");
        var type = asm.GetType("System.Windows.Automation.AutomationElement");
        var el = type.GetProperty("FocusedElement").GetValue(null, null);
        if (el == null) return;
        var cur = type.GetProperty("Current").GetValue(el, null);
        result = (bool)cur.GetType().GetProperty("IsPassword").GetValue(cur, null);
      } catch { }
    }) { IsBackground = true };
    t.Start();
    return t.Join(ms) ? result : null;
  }

  // ---------------------------------------------------------------- guard (user takeover, emergency stop)

  static Dictionary<string, object> Guard(Dictionary<string, object> m) {
    if (!Bool(m, "on")) { GuardOff(); return Ok(); }
    pauseOnInput = Bool(m, "pauseOnInput");
    ownPid = (uint)Num(m, "ownPid", 0);
    movePx = Math.Max(3, (int)Num(m, "movePx", 12));
    var ex = new List<RECT>();
    var list = List(m, "exclude");
    if (list != null) foreach (var o in list) {
      var a = o as IList;
      if (a != null && a.Count == 4) ex.Add(new RECT { left = Convert.ToInt32(a[0]), top = Convert.ToInt32(a[1]), right = Convert.ToInt32(a[2]), bottom = Convert.ToInt32(a[3]) });
    }
    exclude = ex.ToArray();
    var cs = new List<int[]>();
    var cl = List(m, "corners");
    if (cl != null) foreach (var o in cl) {
      var a = o as IList;
      if (a != null && a.Count == 2) cs.Add(new int[] { Convert.ToInt32(a[0]), Convert.ToInt32(a[1]) });
    }
    corners = cs.Count > 0 ? cs.ToArray() : null;
    graceUntil = Environment.TickCount + Math.Max(0, (int)Num(m, "graceMs", 0));
    ResetGuard();
    if (hookThread == null || !hookThread.IsAlive) {
      hookError = null;
      hookReady.Reset();
      hookThread = new Thread(HookLoop) { IsBackground = true, Name = "omni-desk-guard" };
      hookThread.Start();
      if (!hookReady.WaitOne(2000)) hookError = hookError ?? "hook start timed out";
      if (hookError != null) { var e = hookError; GuardOff(); throw new Exception(e); }
    }
    guardOn = true;
    return Ok();
  }

  static void GuardOff() {
    guardOn = false;
    if (hookTid != 0) PostThreadMessageW(hookTid, 0x0012, IntPtr.Zero, IntPtr.Zero);
    if (hookThread != null) hookThread.Join(1000);
    hookThread = null;
  }

  static void ResetGuard() { moved = 0; hasLast = false; takeover = false; }

  static bool Grace() { return Environment.TickCount - graceUntil < 0; }

  static void User(string kind) {
    if (!guardOn || Grace()) return;
    if (pauseOnInput && !takeover) { takeover = true; signals.Add("{\"event\":\"user\",\"kind\":\"" + kind + "\"}"); }
  }

  static bool Excluded(POINT p) {
    foreach (var r in exclude) if (p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom) return true;
    return false;
  }

  /**
   * The pointer is on one of the app's own windows (the pet, her bubble, a card, the main window): the owner
   * answering her is not him taking the mouse back. The topmost visible window under the point, walked in z-order
   * (EnumWindows) rather than WindowFromPoint, which sends WM_NCHITTEST to other programs and may stall the hook.
   * Click-through windows (WS_EX_TRANSPARENT) are skipped: the click lands on what is under them.
   */
  static bool Own(POINT p) {
    if (ownPid == 0) return false;
    bool mine = false;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      if ((GetWindowLong(h, -20) & 0x20) != 0) return true;
      int cloaked = 0;
      try { if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; } catch { }
      RECT r;
      if (!GetWindowRect(h, out r) || p.x < r.left || p.x >= r.right || p.y < r.top || p.y >= r.bottom) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      mine = pid == ownPid;
      return false;
    }, IntPtr.Zero);
    return mine;
  }

  static IntPtr Kb(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(KBDLLHOOKSTRUCT));
      if (k.dwExtraInfo.ToInt64() != MAGIC) {
        int msg = w.ToInt32();
        bool down = msg == 0x100 || msg == 0x104;
        uint vk = k.vkCode;
        if (vk == 0x11 || vk == 0xA2 || vk == 0xA3) ctrlDown = down;
        else if (vk == 0x12 || vk == 0xA4 || vk == 0xA5) altDown = down;
        else if (down && ctrlDown && altDown && (vk == 0x51 || vk == 0x1B) && guardOn) {
          // Ctrl+Alt+Q (Quicksilver's hard stop) or Ctrl+Alt+Esc: works whether or not pause-on-input is on.
          Interlocked.Exchange(ref abortUpTo, Interlocked.Read(ref lastSeen));
          signals.Add("{\"event\":\"hotkey\"}");
        }
        if (down) User("key");
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static IntPtr Ms(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      var m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
      if (m.dwExtraInfo.ToInt64() != MAGIC && Environment.TickCount - selfMoveUntil >= 0) {
        int msg = w.ToInt32();
        if (msg == 0x200) {
          // Mouse flung into a top-left corner = emergency stop (the pyautogui FAILSAFE habit). The app sends the
          // corners the cursor can reach; the virtual desktop's own corner may lie on no screen at all.
          bool corner = false;
          var cs = corners;
          if (cs != null) { foreach (var c in cs) if (m.pt.x >= c[0] && m.pt.x <= c[0] + 1 && m.pt.y >= c[1] && m.pt.y <= c[1] + 1) corner = true; }
          else { int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77); corner = m.pt.x <= vx + 1 && m.pt.y <= vy + 1; }
          if (guardOn && corner) {
            Interlocked.Exchange(ref abortUpTo, Interlocked.Read(ref lastSeen));
            signals.Add("{\"event\":\"corner\"}");
          }
          if (hasLast) moved += Math.Abs(m.pt.x - lastPt.x) + Math.Abs(m.pt.y - lastPt.y);
          lastPt = m.pt;
          hasLast = true;
          if (moved >= movePx && guardOn && pauseOnInput && !takeover && !Excluded(m.pt) && !Own(m.pt)) User("move");
        } else if (guardOn && pauseOnInput && !takeover && !Excluded(m.pt) && !Own(m.pt)) User("mouse");
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static void HookLoop() {
    Aware();
    IntPtr h1 = IntPtr.Zero, h2 = IntPtr.Zero;
    try {
      hookTid = GetCurrentThreadId();
      MSG msg;
      // Create the message queue first so a stop posted during installation is not lost.
      PeekMessageW(out msg, IntPtr.Zero, 0, 0, 0);
      kbProc = Kb; msProc = Ms;
      IntPtr mod = GetModuleHandleW(null);
      h1 = SetWindowsHookExW(13, kbProc, mod, 0);
      if (h1 == IntPtr.Zero) throw new Exception("keyboard hook failed (" + Marshal.GetLastWin32Error() + ")");
      h2 = SetWindowsHookExW(14, msProc, mod, 0);
      if (h2 == IntPtr.Zero) throw new Exception("mouse hook failed (" + Marshal.GetLastWin32Error() + ")");
      hookReady.Set();
      while (true) {
        int r = GetMessageW(out msg, IntPtr.Zero, 0, 0);
        if (r <= 0) break;
      }
    } catch (Exception e) {
      hookError = e.Message;
    } finally {
      if (h1 != IntPtr.Zero) UnhookWindowsHookEx(h1);
      if (h2 != IntPtr.Zero) UnhookWindowsHookEx(h2);
      hookTid = 0;
      if (guardOn && hookError == null) hookError = "the input guard stopped";
      hookReady.Set();
    }
  }
}
}
`;

// System.Windows.Forms: NativeWindow, the clipboard owner window of desktop_paste_files.
const REFERENCES = ['System.Web.Extensions', 'System.Windows.Forms'];

const SCRIPT = `$ErrorActionPreference = 'Stop'
$src = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'omni-desk.cs'), [System.Text.Encoding]::UTF8)
Add-Type -TypeDefinition $src -ReferencedAssemblies @(${REFERENCES.map((r) => `'${r}'`).join(', ')})
[OmniDesk.Host]::Run()
`;

/**
 * One request line. Everything outside printable ASCII is written as a \\uXXXX escape (per UTF-16 unit,
 * so Chinese and emoji survive), which keeps the pipe independent of PowerShell's console code page.
 */
function encodeCommand(msg) {
  return `${JSON.stringify(msg).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

class DeskHelper extends EventEmitter {
  /** @param {{dir: string, spawn?: Function, log?: any, exe?: string}} o */
  constructor(o) {
    super();
    this.dir = o.dir;
    this.spawn = o.spawn || nodeSpawn;
    this.log = o.log;
    this.exe = o.exe || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.proc = null;
    this.ready = null;
    this.seq = 0;
    this.pending = new Map();
  }

  /** Starts the process once; resolves with its `ready` event (virtual screen, pid). */
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'omni-desk.cs'), SOURCE);
      fs.writeFileSync(path.join(this.dir, 'omni-desk.ps1'), SCRIPT);
      const p = this.spawn(this.exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.dir, 'omni-desk.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = p;
      let buf = '';
      let err = '';
      const timer = setTimeout(() => {
        reject(new Error('键鼠控制组件启动超时'));
        this.stop();
      }, 30000);
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let m;
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          if (m.event === 'ready') {
            clearTimeout(timer);
            resolve(m);
          } else if (m.event) this.emit('event', m);
          else this.settle(m);
        }
      });
      p.stderr.setEncoding('utf8');
      p.stderr.on('data', (d) => {
        err = (err + d).slice(-4000);
      });
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('exit', (code) => {
        clearTimeout(timer);
        const why = err.trim().split(/\r?\n/).find((l) => l.trim()) || `退出码 ${code}`;
        reject(new Error(`键鼠控制组件没有启动：${why}`));
        for (const w of this.pending.values()) w.reject(new Error('键鼠控制组件已退出'));
        this.pending.clear();
        this.proc = null;
        this.ready = null;
        this.emit('exit', code);
      });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  settle(m) {
    const w = this.pending.get(m.id);
    if (!w) return;
    this.pending.delete(m.id);
    clearTimeout(w.timer);
    w.resolve(m);
  }

  /** One command; resolves with the helper's reply ({ok, ...} or {ok: false, error, stopped?}). */
  async send(op, args = {}, ms = 30000) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('键鼠控制组件没有响应'));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(encodeCommand({ ...args, id, op }));
    });
  }

  /** Stops every command sent so far, including the one running now. */
  abort() {
    if (!this.proc) return;
    const id = ++this.seq;
    this.proc.stdin.write(encodeCommand({ id, op: 'abort', upTo: id }));
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    this.ready = null;
    if (!p) return;
    try {
      p.stdin.end();
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        p.kill();
      } catch {
        /* already gone */
      }
    }, 2000).unref?.();
  }
}

module.exports = { DeskHelper, encodeCommand, SOURCE, SCRIPT, REFERENCES };
