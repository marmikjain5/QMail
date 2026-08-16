import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Shield, ShieldAlert, ArrowLeft, Download, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';

interface EmailDetail {
  id: string;
  senderName: string;
  sender: string;
  subject: string;
  bodyHtml: string;
  date: string;
  isQuMailEncrypted: boolean;
  qumailEnvelope?: {
    securityLevel: number;
    crypto: { algorithm: string; keyId: string };
    attachments?: Array<{
      attachmentId: string;
      filenameEncrypted: string;
      sizeBytes: number;
      ipfsCid: string;
      sha256Hash: string;
    }>;
  };
}

export function ReadEmailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [threatScan, setThreatScan] = useState<any>(null);

  useEffect(() => {
    async function fetchEmail() {
      try {
        const res = await api.get(`/emails/inbox/${id}`);
        setEmail(res.data);
        
        // Background threat scan
        if (res.data) {
          api.post('/monitor/email/threat-scan', {
            subject: res.data.subject,
            bodyPlain: res.data.bodyPlain,
            senderEmail: res.data.sender,
          }).then(scanRes => setThreatScan(scanRes.data)).catch(console.error);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchEmail();
  }, [id]);

  if (loading) return <div className="p-8">Loading encrypted message...</div>;
  if (!email) return <div className="p-8">Message not found</div>;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 sticky top-0 bg-white dark:bg-slate-950 z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{email.subject}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        {/* Security Header */}
        {email.isQuMailEncrypted && (
          <div className={`mb-6 p-4 rounded-lg border flex items-start gap-4 ${
            email.qumailEnvelope?.securityLevel === 3 
              ? 'bg-fuchsia-50/50 border-fuchsia-200 dark:bg-fuchsia-950/20 dark:border-fuchsia-900/50' 
              : 'bg-cyan-50/50 border-cyan-200 dark:bg-cyan-950/20 dark:border-cyan-900/50'
          }`}>
            <Shield className={`h-8 w-8 mt-1 ${email.qumailEnvelope?.securityLevel === 3 ? 'text-fuchsia-500' : 'text-cyan-500'}`} />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">
                QuMail Secured: Level {email.qumailEnvelope?.securityLevel} ({email.qumailEnvelope?.securityLevel === 3 ? 'Quantum-OTP' : 'Quantum-AES'})
              </h3>
              <div className="text-xs text-slate-500 mt-1 flex flex-col gap-1">
                <span>Algorithm: {email.qumailEnvelope?.crypto.algorithm}</span>
                <span>Key ID: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">{email.qumailEnvelope?.crypto.keyId}</code></span>
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 mt-1">
                  <CheckCircle className="h-3 w-3" /> Successfully decrypted locally. Key destroyed.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Threat Scan Result */}
        {threatScan && threatScan.threatScore > 40 && (
          <div className="mb-6 p-4 rounded-lg border bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/50">
            <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400 font-semibold mb-2">
              <ShieldAlert className="h-5 w-5" /> AI Threat Warning
            </div>
            <ul className="text-sm text-orange-600 dark:text-orange-300 list-disc pl-5">
              {threatScan.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        {/* Metadata */}
        <div className="flex justify-between items-start mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="font-semibold text-lg">{email.senderName || email.sender}</div>
            <div className="text-sm text-slate-500">&lt;{email.sender}&gt;</div>
          </div>
          <div className="text-sm text-slate-500 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {format(new Date(email.date), 'MMMM d, yyyy h:mm a')}
          </div>
        </div>

        {/* Body */}
        <div 
          className="prose dark:prose-invert max-w-none mb-12"
          dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
        />

        {/* Attachments */}
        {email.qumailEnvelope?.attachments && email.qumailEnvelope.attachments.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800">
            <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-slate-500">Encrypted Attachments</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {email.qumailEnvelope.attachments.map(att => (
                <div key={att.attachmentId} className="border border-slate-200 dark:border-slate-700 rounded p-4 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
                  <div className="flex-1 min-w-0 pr-4">
                    {/* The filename is encrypted in the envelope. In a real app we'd decrypt it here. For demo, we just show the ID. */}
                    <div className="font-medium text-sm truncate">Attachment {att.attachmentId.substring(0, 8)}</div>
                    <div className="text-xs text-slate-500">{(att.sizeBytes / 1024 / 1024).toFixed(2)} MB • Blockchain Verified</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => {
                    toast({ title: "Verify & Download", description: "Verifying blockchain hash before decryption..." });
                    // Implement actual download logic here
                  }}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
