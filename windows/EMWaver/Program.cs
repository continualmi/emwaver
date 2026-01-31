using Microsoft.UI.Xaml;
using System;
using System.Runtime.InteropServices;

namespace EMWaver;

public static class Program
{
    [DllImport("Microsoft.ui.xaml.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    private static extern void XamlCheckProcessRequirements();

    [STAThread]
    public static void Main(string[] args)
    {
        XamlCheckProcessRequirements();
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(_ =>
        {
            new App();
        });
    }
}
