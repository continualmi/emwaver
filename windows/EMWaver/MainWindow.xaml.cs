using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Text;

namespace EMWaver;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    private void OnSelfTestClick(object sender, RoutedEventArgs e)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Self-test: Rust buffer core interop");

        try
        {
            // NOTE: This call will start working once the Rust Windows DLL exists and is
            // available on PATH / next to the executable.
            Interop.EmwBufferNative.ClearAll();
            sb.AppendLine("- emw_buffer_clear_all: OK");

            var rxLen = Interop.EmwBufferNative.RxLenBytes();
            sb.AppendLine($"- emw_buffer_rx_len_bytes: {rxLen}");

            StatusText.Text = "OK";
        }
        catch (Exception ex)
        {
            StatusText.Text = "Failed";
            sb.AppendLine("Interop failed (expected until DLL is added):");
            sb.AppendLine(ex.ToString());
        }

        LogText.Text = sb.ToString();
    }
}
