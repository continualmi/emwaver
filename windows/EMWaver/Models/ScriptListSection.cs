using System.Collections.ObjectModel;

namespace EMWaver.Models;

public sealed class ScriptListSection
{
    public string Title { get; }
    public ObservableCollection<object> Items { get; } = new();

    public ScriptListSection(string title)
    {
        Title = title;
    }
}
