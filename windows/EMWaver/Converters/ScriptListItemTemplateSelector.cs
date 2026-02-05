using EMWaver.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace EMWaver.Converters;

public sealed class ScriptListItemTemplateSelector : DataTemplateSelector
{
    public DataTemplate? ScriptTemplate { get; set; }
    public DataTemplate? SignalTemplate { get; set; }

    protected override DataTemplate SelectTemplateCore(object item)
    {
        return item switch
        {
            ScriptInfo => ScriptTemplate!,
            SignalFileInfo => SignalTemplate!,
            _ => ScriptTemplate!,
        };
    }

    protected override DataTemplate SelectTemplateCore(object item, DependencyObject container)
        => SelectTemplateCore(item);
}
