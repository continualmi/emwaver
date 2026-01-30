using EMWaver.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;
using System.Threading.Tasks;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage : Page
{
    private readonly ObservableCollection<ScriptInfo> _scripts = new();

    public ScriptsPage()
    {
        InitializeComponent();
        ScriptsList.ItemsSource = _scripts;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await RefreshAsync();
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            var scripts = await AppServices.Scripts.ListScriptsAsync();

            _scripts.Clear();
            foreach (var s in scripts)
            {
                _scripts.Add(s);
            }
        }
        catch (Exception)
        {
            // Leave whatever is currently shown.
        }
    }
}
