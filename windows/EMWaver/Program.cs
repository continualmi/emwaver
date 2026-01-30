using Microsoft.UI.Xaml;
using System;

namespace EMWaver;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(_ =>
        {
            _ = new App();
        });
    }
}
