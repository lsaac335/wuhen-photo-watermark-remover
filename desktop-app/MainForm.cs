using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WatermarkRemover;

public sealed class MainForm : Form
{
    private readonly WebView2 webView = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = Color.FromArgb(249, 248, 243),
    };

    public MainForm()
    {
        Text = "无痕修图 · 本地照片去水印";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(980, 700);
        BackColor = Color.FromArgb(249, 248, 243);

        var appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (appIcon is not null) Icon = appIcon;

        Controls.Add(webView);
        Shown += async (_, _) => await InitializeWebViewAsync();
        FormClosed += (_, _) => webView.Dispose();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "无痕修图",
                "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            var root = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "app.local",
                root,
                CoreWebView2HostResourceAccessKind.DenyCors);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = false;

            webView.CoreWebView2.NavigationStarting += NavigationStarting;
            webView.CoreWebView2.DownloadStarting += DownloadStarting;
            webView.CoreWebView2.NewWindowRequested += NewWindowRequested;
            webView.CoreWebView2.Navigate("https://app.local/index.html");
        }
        catch (Exception error)
        {
            var choice = MessageBox.Show(
                $"无法启动应用内核。\n\n{error.Message}\n\n是否打开 Microsoft WebView2 安装页面？",
                "无痕修图",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Error);
            if (choice == DialogResult.Yes)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "https://developer.microsoft.com/microsoft-edge/webview2/",
                    UseShellExecute = true,
                });
            }
            Close();
        }
    }

    private void NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs eventArgs)
    {
        if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) && uri.Host == "app.local") return;
        eventArgs.Cancel = true;
    }

    private void NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs eventArgs)
    {
        eventArgs.Handled = true;
        if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
        {
            Process.Start(new ProcessStartInfo { FileName = uri.ToString(), UseShellExecute = true });
        }
    }

    private void DownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs eventArgs)
    {
        using var dialog = new SaveFileDialog
        {
            FileName = Path.GetFileName(eventArgs.ResultFilePath),
            Filter = BuildFilter(eventArgs.ResultFilePath),
            AddExtension = true,
            OverwritePrompt = true,
            Title = "保存修复后的照片",
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            eventArgs.ResultFilePath = dialog.FileName;
            eventArgs.Handled = true;
        }
        else
        {
            eventArgs.Cancel = true;
            eventArgs.Handled = true;
        }
    }

    private static string BuildFilter(string fileName)
    {
        return Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".png" => "PNG 图片 (*.png)|*.png|所有文件 (*.*)|*.*",
            ".jpg" or ".jpeg" => "JPG 图片 (*.jpg)|*.jpg|所有文件 (*.*)|*.*",
            _ => "图片文件 (*.png;*.jpg)|*.png;*.jpg|所有文件 (*.*)|*.*",
        };
    }
}
