using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading;
using System.Threading.Tasks;
using EMWaver.Services;

namespace EMWaver.Pages;

public sealed partial class SettingsPage : Page
{
    private bool _suppressModeSelectionEvents;

    public SettingsPage()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;

        RefreshUi();
        _ = RefreshAgentKeyStatusAsync();
    }

    private void RefreshUi()
    {
        void Apply()
        {
            _suppressModeSelectionEvents = true;
            try
            {
                var themeTag = AppServices.Settings.Theme switch
                {
                    AppThemeMode.Light => "light",
                    AppThemeMode.Dark => "dark",
                    _ => "system",
                };
                foreach (var item in ThemeModeCombo.Items)
                {
                    if (item is ComboBoxItem cbi && (cbi.Tag as string) == themeTag)
                    {
                        ThemeModeCombo.SelectedItem = cbi;
                        break;
                    }
                }

                LocalGatewayToggle.IsOn = AppServices.Settings.LocalGatewayEnabled;
            }
            finally
            {
                _suppressModeSelectionEvents = false;
            }
        }

        if (DispatcherQueue.HasThreadAccess)
        {
            Apply();
            return;
        }

        _ = DispatcherQueue.TryEnqueue(Apply);
    }

    private async Task RefreshAgentKeyStatusAsync()
    {
        try
        {
            await Task.CompletedTask;
            var text = AppServices.AgentKeys.HasAgentKey
                ? "Agent key saved. Local scripts and hardware control remain account-free."
                : "No Agent key saved. Local scripts and hardware control remain available.";

            if (DispatcherQueue.HasThreadAccess)
            {
                AgentKeyStatusText.Text = text;
            }
            else
            {
                _ = DispatcherQueue.TryEnqueue(() => AgentKeyStatusText.Text = text);
            }
        }
        catch (Exception ex)
        {
            if (DispatcherQueue.HasThreadAccess)
            {
                AgentKeyStatusText.Text = ex.Message;
            }
            else
            {
                _ = DispatcherQueue.TryEnqueue(() => AgentKeyStatusText.Text = ex.Message);
            }
        }
    }

    private void OnThemeModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressModeSelectionEvents)
        {
            return;
        }

        if (ThemeModeCombo.SelectedItem is not ComboBoxItem item)
        {
            return;
        }

        var selectedTheme = ((item.Tag as string) ?? "system") switch
        {
            "light" => AppThemeMode.Light,
            "dark" => AppThemeMode.Dark,
            _ => AppThemeMode.System,
        };

        if (AppServices.Settings.Theme == selectedTheme)
        {
            return;
        }

        AppServices.Settings.Theme = selectedTheme;
        RefreshUi();
    }

    private void OnLocalGatewayToggled(object sender, RoutedEventArgs e)
    {
        if (_suppressModeSelectionEvents)
        {
            return;
        }

        AppServices.Settings.LocalGatewayEnabled = LocalGatewayToggle.IsOn;
        RefreshUi();
    }

    private async void OnConfigureAgentKeyClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var dialog = new EMWaver.Dialogs.AccountDialog
            {
                XamlRoot = this.XamlRoot,
            };
            await dialog.ShowAsync();
            await RefreshAgentKeyStatusAsync();
        }
        catch (Exception ex)
        {
            AgentKeyStatusText.Text = ex.Message;
        }
    }

    private async void OnRefreshAgentKeyClick(object sender, RoutedEventArgs e)
    {
        await RefreshAgentKeyStatusAsync();
    }
}
