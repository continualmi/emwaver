using System;
using System.Globalization;
using System.Windows.Data;
using EMWaver.Services;

namespace EMWaver.Converters;

public class ThemeToIndexConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is AppThemeMode mode ? (int)mode : 0;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is int index ? (AppThemeMode)index : AppThemeMode.System;
    }
}
