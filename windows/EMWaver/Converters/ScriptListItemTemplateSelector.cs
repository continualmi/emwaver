using EMWaver.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace EMWaver.Converters;

public sealed class ScriptListItemTemplateSelector : DataTemplateSelector
{
    public DataTemplate? ScriptTemplate { get; set; }
    public DataTemplate? SignalTemplate { get; set; }
    public DataTemplate? SessionTemplate { get; set; }

    protected override DataTemplate SelectTemplateCore(object item)
    {
        return item switch
        {
            ScriptSessionInfo => SessionTemplate ?? ScriptTemplate!,
            ScriptInfo => ScriptTemplate!,
            SignalFileInfo => SignalTemplate!,
            _ => ScriptTemplate!,
        };
    }

    protected override DataTemplate SelectTemplateCore(object item, DependencyObject container)
        => SelectTemplateCore(item);
}
