using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using EMWaver.Models;
using EMWaver.Services;

namespace EMWaver.ViewModels;

public class ScriptsViewModel : INotifyPropertyChanged
{
    private readonly ScriptRepository _scripts;

    public ScriptsViewModel(ScriptRepository scripts)
    {
        _scripts = scripts;
    }

    public ObservableCollection<ScriptInfo> Scripts => _scripts.All;

    private ScriptInfo? _selectedScript;
    public ScriptInfo? SelectedScript
    {
        get => _selectedScript;
        set
        {
            if (_selectedScript != value)
            {
                _selectedScript = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(HasSelection));
            }
        }
    }

    public bool HasSelection => _selectedScript != null;

    private string _editorText = "";
    public string EditorText
    {
        get => _editorText;
        set { _editorText = value; OnPropertyChanged(); }
    }

    private bool _isPreviewMode;
    public bool IsPreviewMode
    {
        get => _isPreviewMode;
        set { _isPreviewMode = value; OnPropertyChanged(); OnPropertyChanged(nameof(IsCodeMode)); }
    }

    public bool IsCodeMode => !_isPreviewMode;

    private string _errorMessage = "";
    public string ErrorMessage
    {
        get => _errorMessage;
        set { _errorMessage = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasError)); }
    }

    public bool HasError => !string.IsNullOrWhiteSpace(_errorMessage);

    // --- Commands ---

    public ICommand SelectScriptCommand => new RelayCommand(param =>
    {
        if (param is ScriptInfo info) SelectedScript = info;
    });

    public ICommand NewScriptCommand => new RelayCommand(_ => NewScriptRequested?.Invoke());
    public ICommand SaveScriptCommand => new RelayCommand(_ => SaveScriptRequested?.Invoke());
    public ICommand CopyScriptCommand => new RelayCommand(_ => CopyScriptRequested?.Invoke());
    public ICommand RenameScriptCommand => new RelayCommand(_ => RenameScriptRequested?.Invoke());
    public ICommand DeleteScriptCommand => new RelayCommand(_ => DeleteScriptRequested?.Invoke());

    public ICommand TogglePreviewModeCommand => new RelayCommand(_ =>
    {
        IsPreviewMode = !IsPreviewMode;
        if (IsPreviewMode) RunScriptRequested?.Invoke();
    });

    public ICommand RunScriptCommand => new RelayCommand(_ => RunScriptRequested?.Invoke());
    public ICommand StopScriptCommand => new RelayCommand(_ => StopScriptRequested?.Invoke());

    public event Action? NewScriptRequested;
    public event Action? SaveScriptRequested;
    public event Action? CopyScriptRequested;
    public event Action? RenameScriptRequested;
    public event Action? DeleteScriptRequested;
    public event Action? RunScriptRequested;
    public event Action? StopScriptRequested;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
