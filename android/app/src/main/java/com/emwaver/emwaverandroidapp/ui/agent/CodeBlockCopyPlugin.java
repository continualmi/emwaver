package com.emwaver.emwaverandroidapp.ui.agent;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ClickableSpan;
import android.view.View;
import android.widget.Toast;

import androidx.annotation.NonNull;

import org.commonmark.node.FencedCodeBlock;

import io.noties.markwon.AbstractMarkwonPlugin;
import io.noties.markwon.MarkwonVisitor;

public class CodeBlockCopyPlugin extends AbstractMarkwonPlugin {
    
    private final Context context;
    
    public CodeBlockCopyPlugin(Context context) {
        this.context = context;
    }
    
    @Override
    public void beforeSetText(@NonNull android.widget.TextView textView, @NonNull Spanned markdown) {
        textView.setOnLongClickListener(v -> {
            CharSequence text = textView.getText();
            if (text instanceof Spanned) {
                Spanned spanned = (Spanned) text;
                CodeCopySpan[] spans = spanned.getSpans(0, spanned.length(), CodeCopySpan.class);
                if (spans.length > 0) {
                    for (CodeCopySpan span : spans) {
                        span.copyToClipboard();
                    }
                    return true;
                }
            }
            return false;
        });
    }
    
    @Override
    public void afterSetText(@NonNull android.widget.TextView textView) {
        CharSequence text = textView.getText();
        if (text instanceof Spanned) {
            Spanned spanned = (Spanned) text;
            
            String fullText = spanned.toString();
            int searchPos = 0;
            
            while (searchPos < fullText.length()) {
                int codeStart = fullText.indexOf("```", searchPos);
                if (codeStart == -1) break;
                
                int codeContentStart = fullText.indexOf("\n", codeStart);
                if (codeContentStart == -1) break;
                codeContentStart++;
                
                int codeEnd = fullText.indexOf("```", codeContentStart);
                if (codeEnd == -1) break;
                
                String codeContent = fullText.substring(codeContentStart, codeEnd);
                
                android.text.SpannableStringBuilder builder = new android.text.SpannableStringBuilder(spanned);
                builder.insert(codeEnd + 3, "\n[Copy Code]");
                builder.setSpan(
                    new CodeCopySpan(context, codeContent),
                    codeEnd + 4,
                    codeEnd + 4 + "[Copy Code]".length(),
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                );
                
                textView.setText(builder);
                break;
            }
        }
    }
    
    private static class CodeCopySpan extends ClickableSpan {
        
        private final Context context;
        private final String codeContent;
        
        CodeCopySpan(Context context, String codeContent) {
            this.context = context;
            this.codeContent = codeContent;
        }
        
        @Override
        public void onClick(@NonNull View widget) {
            copyToClipboard();
        }
        
        public void copyToClipboard() {
            if (codeContent != null && context != null) {
                ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("code", codeContent);
                clipboard.setPrimaryClip(clip);
                Toast.makeText(context, "Code copied", Toast.LENGTH_SHORT).show();
            }
        }
    }
}
