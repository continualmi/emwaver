using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace EMWaver.Scripting.Render;

/// <summary>
/// Minimal placeholder text helper for WPF TextBox and PasswordBox.
/// WPF doesn't have PlaceholderText natively — we layer a TextBlock on top
/// that hides when the control has focus or content.
/// </summary>
internal static class PlaceholderHelper
{
    private static readonly DependencyProperty PlaceholderProperty =
        DependencyProperty.RegisterAttached("Placeholder", typeof(string), typeof(PlaceholderHelper),
            new PropertyMetadata(null, OnPlaceholderChanged));

    private static readonly DependencyProperty PlaceholderAdornerProperty =
        DependencyProperty.RegisterAttached("PlaceholderAdorner", typeof(TextBlock), typeof(PlaceholderHelper));

    internal static void SetPlaceholder(Control control, string placeholder)
    {
        if (string.IsNullOrWhiteSpace(placeholder)) return;
        control.SetValue(PlaceholderProperty, placeholder);
    }

    private static void OnPlaceholderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not Control control) return;
        var text = e.NewValue as string;
        if (string.IsNullOrWhiteSpace(text)) return;

        control.Loaded += (_, _) => AttachPlaceholder(control, text);
    }

    private static void AttachPlaceholder(Control control, string text)
    {
        var placeholder = new TextBlock
        {
            Text = text,
            Foreground = Brushes.Gray,
            FontStyle = FontStyles.Italic,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(5, 0, 0, 0),
            IsHitTestVisible = false,
        };

        control.SetValue(PlaceholderAdornerProperty, placeholder);

        if (control.Parent is Panel panel)
        {
            var idx = panel.Children.IndexOf(control);
            panel.Children.Insert(idx, placeholder);

            UpdatePlaceholderVisibility(control, placeholder);

            control.GotFocus += (_, __) => placeholder.Visibility = Visibility.Collapsed;
            control.LostFocus += (_, __) => UpdatePlaceholderVisibility(control, placeholder);

            if (control is TextBox tb)
            {
                // Adorner layer approach doesn't work easily in simple cases.
                // Instead we use a simpler approach: track text changes.
                var wasEmpty = string.IsNullOrEmpty(tb.Text);
                tb.TextChanged += (_, __) =>
                {
                    UpdatePlaceholderVisibility(control, placeholder);
                };
            }
            if (control is PasswordBox pb)
            {
                var wasEmpty = string.IsNullOrEmpty(pb.Password);
                pb.PasswordChanged += (_, __) =>
                {
                    UpdatePlaceholderVisibility(control, placeholder);
                };
            }
        }
    }

    private static void UpdatePlaceholderVisibility(Control control, TextBlock placeholder)
    {
        var hasContent = control switch
        {
            TextBox tb => !string.IsNullOrEmpty(tb.Text),
            PasswordBox pb => !string.IsNullOrEmpty(pb.Password),
            _ => false,
        };

        placeholder.Visibility = (hasContent || control.IsFocused) ? Visibility.Collapsed : Visibility.Visible;
    }
}
