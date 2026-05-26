using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using EMWaver.Services;

namespace EMWaver.ViewModels;

public class SettingsViewModel : INotifyPropertyChanged
{
    private readonly AppSettings _settings;

    public SettingsViewModel(AppSettings settings)
    {
        _settings = settings;
    }

    public bool ShowTransportLog
    {
        get => _settings.ShowTransportLog;
        set
        {
            if (_settings.ShowTransportLog != value)
            {
                _settings.ShowTransportLog = value;
                OnPropertyChanged();
            }
        }
    }

    public string MgptApiUrl => "https://mdl.continualmi.com/mgpt-api";

    public string AppVersion
    {
        get
        {
            var version = AppBuildInfo.Version.Trim();
            if (string.IsNullOrWhiteSpace(version)) return "unknown";
            var plus = version.IndexOf('+');
            return plus < 0 ? version : version[..plus];
        }
    }

    public string AppCommit
    {
        get
        {
            var version = AppBuildInfo.Version;
            var plus = version.IndexOf('+');
            if (plus < 0 || plus + 1 >= version.Length) return "unknown";
            var metadata = version[(plus + 1)..].Trim();
            if (string.IsNullOrWhiteSpace(metadata)) return "unknown";
            if (metadata.StartsWith("local.", StringComparison.OrdinalIgnoreCase))
            {
                metadata = metadata["local.".Length..].Trim();
            }
            return metadata.Length > 7 ? metadata[..7] : metadata;
        }
    }

    public ICommand DoneCommand => new RelayCommand(_ => DoneRequested?.Invoke());

    public event Action? DoneRequested;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
