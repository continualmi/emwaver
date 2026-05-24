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

    public AppThemeMode Theme
    {
        get => _settings.Theme;
        set
        {
            if (_settings.Theme != value)
            {
                _settings.Theme = value;
                OnPropertyChanged();
            }
        }
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

    public bool TransportDebugLoggingEnabled
    {
        get => _settings.TransportDebugLoggingEnabled;
        set
        {
            if (_settings.TransportDebugLoggingEnabled != value)
            {
                _settings.TransportDebugLoggingEnabled = value;
                OnPropertyChanged();
            }
        }
    }

    public string MgptApiUrl => "https://mdl.continualmi.com/mgpt-api";

    public ICommand DoneCommand => new RelayCommand(_ => DoneRequested?.Invoke());

    public event Action? DoneRequested;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
