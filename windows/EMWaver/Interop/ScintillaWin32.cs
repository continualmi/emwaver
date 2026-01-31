using System;
using System.Runtime.InteropServices;

namespace EMWaver.Interop;

internal static class ScintillaWin32
{
    // Win32
    internal const int WS_CHILD = 0x40000000;
    internal const int WS_VISIBLE = 0x10000000;
    internal const int WS_TABSTOP = 0x00010000;
    internal const int WS_CLIPSIBLINGS = 0x04000000;
    internal const int WS_CLIPCHILDREN = 0x02000000;
    internal const int WS_POPUP = unchecked((int)0x80000000);

    internal const int SW_HIDE = 0;
    internal const int SW_SHOW = 5;

    internal static readonly IntPtr HWND_TOP = new(0);

    internal const uint SWP_NOACTIVATE = 0x0010;
    internal const uint SWP_NOZORDER = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        public int x;
        public int y;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern IntPtr LoadLibraryW(string lpFileName);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern IntPtr CreateWindowExW(
        int dwExStyle,
        string lpClassName,
        string lpWindowName,
        int dwStyle,
        int x,
        int y,
        int nWidth,
        int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern int SetWindowTheme(IntPtr hWnd, string? pszSubAppName, string? pszSubIdList);

    [DllImport("dwmapi.dll", PreserveSig = true)]
    internal static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    // DWM attributes (undocumented-ish behavior across versions; best-effort)
    internal const int DWMWA_USE_IMMERSIVE_DARK_MODE_19 = 19;
    internal const int DWMWA_USE_IMMERSIVE_DARK_MODE_20 = 20;

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern IntPtr SendMessageW(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    // Scintilla messages (subset)
    internal const int SCI_SETCODEPAGE = 2037;
    internal const int SC_CP_UTF8 = 65001;

    internal const int SCI_SETTEXT = 2181;
    internal const int SCI_GETTEXT = 2182;
    internal const int SCI_GETTEXTLENGTH = 2183;

    internal const int SCI_SETREADONLY = 2171;
    internal const int SCI_GETMODIFY = 2159;
    internal const int SCI_SETSAVEPOINT = 2014;

    internal const int SCI_SETLEXER = 4001;
    internal const int SCI_SETKEYWORDS = 4005;

    internal const int SCI_STYLESETFORE = 2051;
    internal const int SCI_STYLESETBACK = 2052;
    internal const int SCI_STYLESETBOLD = 2053;
    internal const int SCI_STYLESETSIZE = 2055;
    internal const int SCI_STYLESETFONT = 2056;
    internal const int SCI_STYLECLEARALL = 2050;

    internal const int SCI_SETCARETFORE = 2069;
    internal const int SCI_SETSELBACK = 2068;
    internal const int SCI_SETSELFORE = 2067;

    internal const int SCI_SETMARGINWIDTHN = 2242;
    internal const int SCI_SETMARGINTYPEN = 2240;

    internal const int SCI_SETCARETLINEVISIBLE = 2096;
    internal const int SCI_SETCARETLINEBACK = 2098;

    // Style / lexer constants
    internal const int SCLEX_CPP = 3;

    internal const int STYLE_DEFAULT = 32;

    // C++ lexer style IDs (used for JS-ish highlighting too)
    internal const int SCE_C_DEFAULT = 0;
    internal const int SCE_C_COMMENT = 1;
    internal const int SCE_C_COMMENTLINE = 2;
    internal const int SCE_C_COMMENTDOC = 3;
    internal const int SCE_C_NUMBER = 4;
    internal const int SCE_C_WORD = 5;
    internal const int SCE_C_STRING = 6;
    internal const int SCE_C_CHARACTER = 7;
    internal const int SCE_C_PREPROCESSOR = 9;
    internal const int SCE_C_OPERATOR = 10;

    internal static int Rgb(int r, int g, int b) => (r & 0xFF) | ((g & 0xFF) << 8) | ((b & 0xFF) << 16);

    internal static void Send(IntPtr hwnd, int msg, int wParam, int lParam)
    {
        _ = SendMessageW(hwnd, msg, new IntPtr(wParam), new IntPtr(lParam));
    }

    internal static void SendPtr(IntPtr hwnd, int msg, int wParam, IntPtr lParam)
    {
        _ = SendMessageW(hwnd, msg, new IntPtr(wParam), lParam);
    }
}
