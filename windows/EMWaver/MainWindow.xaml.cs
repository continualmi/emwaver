using EMWaver.Dialogs;
using EMWaver.Interop;
using EMWaver.Models;
using EMWaver.Pages;
using EMWaver.Services.Cloud;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using System;
using System.Collections.Specialized;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using WinRT.Interop;
using Microsoft.UI.Windowing;

namespace EMWaver;

public sealed partial class MainWindow : Window
{
    private ScriptsPage? _scriptsPage;

    public MainWindow()
    {
        InitializeComponent();

        // Dark-mode only (Windows app).
        RootGrid.RequestedTheme = ElementTheme.Dark;

        // Ensure the window/titlebar icon matches the app icon.
        TrySetWindowIcon();

        AppServices.Device.AttachUiDispatcher(DispatcherQueue.GetForCurrentThread());
        AppServices.FirmwareUpdater.AttachUiDispatcher(DispatcherQueue.GetForCurrentThread());

        AppServices.Device.PropertyChanged += OnDevicePropertyChanged;

        AppServices.Device.AvailablePorts.CollectionChanged += OnPortsCollectionChanged;

        ContentFrame.Navigated += OnContentNavigated;
        ContentFrame.Navigate(typeof(Pages.ScriptsPage));
        _ = BootstrapAsync();

        // Initial UI state.
        RunOnUi(() =>
        {
            UpdateDeviceStatus();
            RebuildConnectMenu();
        });
    }

    private void TrySetWindowIcon()
    {
        try
        {
            // AppWindow expects a filesystem path.
            var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "emwaver.ico");
            if (!File.Exists(iconPath))
            {
                // Fallback for older layouts.
                iconPath = Path.Combine(AppContext.BaseDirectory, "emwaver.ico");
            }

            if (!File.Exists(iconPath) || App.MainWindow == null)
            {
                return;
            }

            var hwnd = WindowNative.GetWindowHandle(App.MainWindow);

            // 1) Best-effort: AppWindow icon (taskbar/alt-tab, depends on host)
            try
            {
                var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
                var appWindow = AppWindow.GetFromWindowId(windowId);
                appWindow.SetIcon(iconPath);
            }
            catch
            {
                // Ignore.
            }

            // 2) Set the Win32 window icon (top-left titlebar icon)
            try
            {
                SetWin32WindowIcons(hwnd, iconPath);
            }
            catch
            {
                // Ignore.
            }
        }
        catch
        {
            // Non-fatal. Some environments can throw if the window isn't ready yet.
        }
    }

    private static void SetWin32WindowIcons(IntPtr hwnd, string icoPath)
    {
        // Load the icon from file and apply to the window.
        // This updates the small titlebar icon shown to the left of the window title.
        const uint IMAGE_ICON = 1;
        const uint LR_LOADFROMFILE = 0x0010;
        const int WM_SETICON = 0x0080;
        const int ICON_SMALL = 0;
        const int ICON_BIG = 1;

        var hIcon = LoadImageW(IntPtr.Zero, icoPath, IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
        if (hIcon == IntPtr.Zero)
        {
            return;
        }

        _ = SendMessageW(hwnd, WM_SETICON, new IntPtr(ICON_SMALL), hIcon);
        _ = SendMessageW(hwnd, WM_SETICON, new IntPtr(ICON_BIG), hIcon);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadImageW(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern IntPtr SendMessageW(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private void OnContentNavigated(object sender, NavigationEventArgs e)
    {
        if (_scriptsPage != null)
        {
            _scriptsPage.ToolbarStateChanged -= OnScriptsToolbarStateChanged;
            _scriptsPage.PreviewModeChanged -= OnScriptsPreviewModeChanged;
        }

        _scriptsPage = e.Content as ScriptsPage;
        if (_scriptsPage != null)
        {
            _scriptsPage.ToolbarStateChanged += OnScriptsToolbarStateChanged;
            _scriptsPage.PreviewModeChanged += OnScriptsPreviewModeChanged;
            OnScriptsToolbarStateChanged(_scriptsPage.CurrentToolbarState);
            OnScriptsPreviewModeChanged(false);
            ScriptsCommandBar.Visibility = Visibility.Visible;
        }
        else
        {
            ScriptsCommandBar.Visibility = Visibility.Collapsed;
        }

        // Top-level navigation UX
        var isSettings = e.Content is SettingsPage;

        // Settings is a "focused" page: hide device/connect + script toolbar clutter.
        DeviceMenuButton.Visibility = isSettings ? Visibility.Collapsed : Visibility.Visible;
        ScriptsCommandBar.Visibility = isSettings ? Visibility.Collapsed : Visibility.Visible;
        AppCommandBar.Visibility = isSettings ? Visibility.Collapsed : Visibility.Visible;

        TopBackButton.Visibility = isSettings ? Visibility.Visible : Visibility.Collapsed;
        TopAppIcon.Visibility = isSettings ? Visibility.Collapsed : Visibility.Visible;

        TopBackButton.IsEnabled = ContentFrame.CanGoBack;
    }

    private void OnBackClick(object sender, RoutedEventArgs e)
    {
        if (ContentFrame.CanGoBack)
        {
            ContentFrame.GoBack();
        }
        TopBackButton.IsEnabled = ContentFrame.CanGoBack;
    }

    private void OnTopSettingsClick(object sender, RoutedEventArgs e)
    {
        ContentFrame.Navigate(typeof(SettingsPage));
        TopBackButton.IsEnabled = ContentFrame.CanGoBack;
    }

    private void RunOnUi(Action action)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            action();
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() => action());
    }

    private void OnPortsCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        RunOnUi(RebuildConnectMenu);
    }

    private async Task BootstrapAsync()
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            await AppServices.Device.RefreshPortsAsync();
        }
        catch (Exception ex)
        {
            DeviceStatusText.Text = "Error";
            DeviceVersionText.Text = ex.Message;
        }

        UpdateDeviceStatus();
        RebuildConnectMenu();
    }

    private void OnDevicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Device manager can raise PropertyChanged off-UI-thread.
        RunOnUi(() =>
        {
            UpdateDeviceStatus();

            if (e.PropertyName == nameof(AppServices.Device.AutoConnectEnabled)
                || e.PropertyName == nameof(AppServices.Device.ConnectedPort)
                || e.PropertyName == nameof(AppServices.Device.IsConnected))
            {
                RebuildConnectMenu();
            }
        });
    }

    private void UpdateDeviceStatus()
    {
        var device = AppServices.Device;
        switch (device.Mode)
        {
            case Services.DeviceMode.RunMode:
                DeviceStatusText.Text = "Connected";
                break;
            case Services.DeviceMode.UpdateMode:
                DeviceStatusText.Text = "Update Mode";
                break;
            default:
                DeviceStatusText.Text = "Disconnected";
                break;
        }

        var connected = device.IsConnected;

        DeviceVersionText.Text = connected && !string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion)
            ? $"EMWaver {device.DeviceEmwaverVersion}"
            : string.Empty;

        // Cable icon state
        CableIconConnected.Visibility = connected ? Visibility.Visible : Visibility.Collapsed;
        CableIconDisconnected.Visibility = connected ? Visibility.Collapsed : Visibility.Visible;

        if (device.IsConnected && NativeBufferRust.IsAvailable)
        {
            var rx = NativeBufferRust.GetRxPacketCount();
            var tx = NativeBufferRust.GetTxPacketCount();
            // Debug RX/TX counter UI removed.
        }
        else
        {
            // Debug RX/TX counter UI removed.
        }

        AutoConnectMenuItem.IsChecked = device.AutoConnectEnabled;
        // Keep a fast UI hint using the built-in VID/PID scan, but also keep parity with
        // macOS by polling the shared DFU helper (libusb) in the background.
        UpdateModeStatusItem.Text = (device.DfuConnected || AppServices.FirmwareUpdater.DfuConnected)
            ? "Update Mode: Detected"
            : "Update Mode: Not detected";

        if (!string.IsNullOrWhiteSpace(device.LastErrorText))
        {
            LastErrorMenuItem.Text = device.LastErrorText;
            LastErrorMenuItem.Visibility = Visibility.Visible;
        }
        else
        {
            LastErrorMenuItem.Text = string.Empty;
            LastErrorMenuItem.Visibility = Visibility.Collapsed;
        }
    }

    private void OnScriptsToolbarStateChanged(ScriptToolbarState state)
    {
        ScriptCodeToggleButton.IsEnabled = state.HasSelection;
        ScriptPreviewToggleButton.IsEnabled = state.CanPreview;

        if (!state.HasSelection)
        {
            // No selection: force Code mode.
            SetScriptModeUi(preview: false);
        }
        else
        {
            // Ensure one of the modes is always selected.
            if (ScriptCodeToggleButton.IsChecked != true && ScriptPreviewToggleButton.IsChecked != true)
            {
                SetScriptModeUi(preview: false);
            }
        }

        ScriptSaveButton.IsEnabled = state.CanSave;
        ScriptCopyButton.IsEnabled = state.CanCopy;
        ScriptRenameButton.IsEnabled = state.CanRename;
        ScriptDeleteButton.IsEnabled = state.CanDelete;
    }

    private void RebuildConnectMenu()
    {
        ConnectSubmenu.Items.Clear();

        var ports = AppServices.Device.AvailablePorts.ToList();
        if (ports.Count == 0)
        {
            var item = new MenuFlyoutItem { Text = "No ports", IsEnabled = false };
            ConnectSubmenu.Items.Add(item);
            return;
        }

        foreach (var p in ports)
        {
            var isCurrent = AppServices.Device.IsConnected
                && AppServices.Device.ConnectedPort?.DisplayName == p.DisplayName;

            var item = new MenuFlyoutItem { Text = p.DisplayName };
            if (isCurrent)
            {
                item.Icon = new SymbolIcon(Symbol.Accept);
            }

            item.Click += async (_, __) =>
            {
                await AppServices.Device.ConnectAsync(p);
                UpdateDeviceStatus();
                RebuildConnectMenu();
            };

            ConnectSubmenu.Items.Add(item);
        }
    }

    private async void OnRefreshPortsClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshPortsAsync();
        RunOnUi(RebuildConnectMenu);
    }

    private void OnAutoConnectClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.AutoConnectEnabled = AutoConnectMenuItem.IsChecked;
    }

    private void OnDisconnectClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.Disconnect();
    }

    private void OnEnterUpdateModeClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.RequestEnterUpdateMode();
        AppServices.Device.Disconnect();
        _ = AppServices.Device.RefreshDfuPresenceAsync();
    }

    private async void OnRefreshUpdateModeClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshDfuPresenceAsync();
        await AppServices.FirmwareUpdater.RefreshDfuPresenceAsync();
    }

    private async void OnUpdateFirmwareClick(object sender, RoutedEventArgs e)
    {
        var dlg = new FirmwareUpdateDialog(AppServices.Device, AppServices.FirmwareUpdater)
        {
            XamlRoot = this.Content.XamlRoot,
        };

        await dlg.ShowAsync();
    }

    private bool _suppressScriptModeUi;

    private void SetScriptModeUi(bool preview)
    {
        if (_suppressScriptModeUi) return;
        _suppressScriptModeUi = true;
        try
        {
            ScriptCodeToggleButton.IsChecked = !preview;
            ScriptPreviewToggleButton.IsChecked = preview;
        }
        finally
        {
            _suppressScriptModeUi = false;
        }
    }

    private void OnScriptCodeModeClick(object sender, RoutedEventArgs e)
    {
        if (_suppressScriptModeUi) return;

        SetScriptModeUi(preview: false);
        _scriptsPage?.HandleToolbarPreviewToggle(false);
    }

    private void OnScriptPreviewModeClick(object sender, RoutedEventArgs e)
    {
        if (_suppressScriptModeUi) return;

        // Entering Preview mode should run the current script.
        SetScriptModeUi(preview: true);
        _scriptsPage?.HandleToolbarRun();
    }

    private void OnScriptNewClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarNew();
    }

    private void OnScriptSaveClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarSave();
    }

    private void OnScriptCopyClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarMakeCopy();
    }

    private void OnScriptRenameClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarRename();
    }

    private void OnScriptDeleteClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarDelete();
    }

    private void OnScriptRefreshClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarRefresh();
    }

    private void OnScriptSyncClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarSync();
    }

    private void OnScriptAgentToggleClick(object sender, RoutedEventArgs e)
    {
        _scriptsPage?.HandleToolbarAgentToggle(ScriptAgentToggleButton.IsChecked == true);
    }

    private void OnCloudSignInClick(object sender, RoutedEventArgs e)
    {
        // Keep toolbar buttons as shortcuts; route to Settings.
        ContentFrame.Navigate(typeof(SettingsPage));
    }

    private void OnCloudTestClick(object sender, RoutedEventArgs e)
    {
        // Keep toolbar buttons as shortcuts; route to Settings.
        ContentFrame.Navigate(typeof(SettingsPage));
    }

    private void OnSettingsClick(object sender, RoutedEventArgs e)
    {
        ContentFrame.Navigate(typeof(SettingsPage));
        TopBackButton.IsEnabled = ContentFrame.CanGoBack;
    }
}
