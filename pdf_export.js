/**
 * ZeroScribe AI - Document Exporter Library (TXT & Formatted PDF)
 */

const ZeroScribeExporter = {
  // Export plain text transcript
  exportTXT: function (captions, meetingName = 'ZeroScribe_Meeting_Transcript') {
    if (!captions || captions.length === 0) {
      alert('No transcript items available to export.');
      return;
    }

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const timeStr = new Date().toLocaleTimeString();

    let content = `===========================================================\n`;
    let platform = captions[0]?.platform || 'Live Meeting';
    content += `ZEROSCRIBE AI - MEETING TRANSCRIPT REPORT\n`;
    content += `Platform: ${platform}\n`;
    content += `Date: ${dateStr} at ${timeStr}\n`;
    content += `Total Captured Lines: ${captions.length}\n`;
    content += `===========================================================\n\n`;

    captions.forEach(item => {
      content += `[${item.timestamp}] ${item.speaker}:\n  ${item.text}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = `${meetingName}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Export PDF formatted transcript via modern printable print window
  exportPDF: function (captions, meetingName = 'ZeroScribe_Meeting_Transcript') {
    if (!captions || captions.length === 0) {
      alert('No transcript items available to export.');
      return;
    }

    const platform = captions[0]?.platform || 'Live Meeting';
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const timeStr = new Date().toLocaleTimeString();

    // Group captions by speaker for clean visual blocks
    let rowsHtml = '';
    captions.forEach(item => {
      rowsHtml += `
        <div class="transcript-row">
          <div class="meta">
            <span class="speaker">${escapeHtml(item.speaker)}</span>
            <span class="timestamp">${escapeHtml(item.timestamp)}</span>
          </div>
          <div class="text">${escapeHtml(item.text)}</div>
        </div>
      `;
    });

    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(meetingName)} - ZeroScribe AI</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          body {
            font-family: 'Inter', -apple-system, sans-serif;
            color: #0f172a;
            background: #ffffff;
            margin: 0;
            padding: 40px;
            font-size: 14px;
            line-height: 1.6;
          }
          .header {
            border-bottom: 2px solid #3b82f6;
            padding-bottom: 20px;
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .brand {
            font-size: 24px;
            font-weight: 800;
            color: #1e293b;
            letter-spacing: -0.5px;
          }
          .brand span {
            color: #3b82f6;
          }
          .sub {
            font-size: 13px;
            color: #64748b;
            margin-top: 4px;
          }
          .meta-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 18px;
            margin-bottom: 25px;
            display: flex;
            gap: 24px;
            font-size: 13px;
          }
          .meta-item {
            display: flex;
            gap: 6px;
          }
          .meta-item strong {
            color: #475569;
          }
          .transcript-row {
            padding: 12px 0;
            border-bottom: 1px solid #f1f5f9;
            page-break-inside: avoid;
          }
          .meta {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 4px;
          }
          .speaker {
            font-weight: 700;
            color: #2563eb;
            font-size: 13px;
            background: #eff6ff;
            padding: 2px 8px;
            border-radius: 6px;
          }
          .timestamp {
            font-size: 12px;
            color: #94a3b8;
          }
          .text {
            color: #334155;
            font-size: 14px;
          }
          .footer {
            margin-top: 40px;
            padding-top: 15px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            font-size: 12px;
            color: #94a3b8;
          }
          @media print {
            body { padding: 20px; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">ZeroScribe <span>AI</span></div>
            <div class="sub">Zero-Backend Live Meeting Copilot & Relay Report</div>
          </div>
          <button onclick="window.print()" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">Save as PDF</button>
        </div>

        <div class="meta-box">
          <div class="meta-item"><strong>Platform:</strong> <span>${escapeHtml(platform)}</span></div>
          <div class="meta-item"><strong>Date:</strong> <span>${dateStr}</span></div>
          <div class="meta-item"><strong>Lines:</strong> <span>${captions.length}</span></div>
        </div>

        <div class="content">
          ${rowsHtml}
        </div>

        <div class="footer">
          Generated automatically by ZeroScribe AI Extension • ${timeStr}
        </div>

        <script>
          // Automatically trigger print dialog on window open
          window.onload = function() {
            setTimeout(function() { window.print(); }, 500);
          };
        </script>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printHtml);
      printWindow.document.close();
    } else {
      alert('Please allow popups to generate and view the PDF report.');
    }
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}
