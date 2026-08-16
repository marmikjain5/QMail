import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ShieldAlert, Zap, Activity, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export function MonitorPage() {
  const [data, setData] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    // Initial fetch
    api.get('/monitor/qkd/history?limit=30').then(res => setData(res.data.logs));
    api.get('/monitor/qkd/anomalies').then(res => setAnomalies(res.data.anomalies));
    api.get('/qkm/status').then(res => setStatus(res.data));

    // Event Source for live telemetry
    const sse = new EventSource('http://localhost:3000/api/monitor/qkd/stream');
    
    sse.onmessage = (e) => {
      const reading = JSON.parse(e.data);
      if (reading.type === 'telemetry') {
        setData(prev => {
          const next = [...prev, reading.data].slice(-30);
          return next;
        });
      } else if (reading.type === 'anomaly') {
        setAnomalies(prev => [reading.data, ...prev].slice(0, 20));
      }
    };

    const statusInterval = setInterval(() => {
      api.get('/qkm/status').then(res => setStatus(res.data));
    }, 5000);

    return () => {
      sse.close();
      clearInterval(statusInterval);
    };
  }, []);

  const handleSimulate = async (state: string) => {
    setSimulating(true);
    await api.post('/monitor/qkd/simulate', { state });
    setTimeout(() => setSimulating(false), 1000);
  };

  const latest = data[data.length - 1];

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-2">QKD Telemetry & AI Monitor</h1>
          <p className="text-slate-500">Live BB84 channel statistics and Isolation Forest anomaly detection.</p>
        </div>
        
        <div className="flex gap-2 bg-slate-100 dark:bg-slate-900 p-1 rounded-md border border-slate-200 dark:border-slate-800">
          {['NORMAL', 'TURBULENCE', 'ANOMALOUS', 'DEAD'].map(state => (
            <Button 
              key={state} 
              variant={latest?.channelState === state ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleSimulate(state)}
              disabled={simulating}
              className={latest?.channelState === state ? 'bg-cyan-600 text-white' : ''}
            >
              {state}
            </Button>
          ))}
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="border rounded-xl p-4 bg-white dark:bg-slate-950">
          <div className="text-sm font-medium text-slate-500 mb-1">Key Pool Available</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">
            {status ? (status.availableKeyBits / 8 / 1024 / 1024).toFixed(2) : '-'} <span className="text-lg font-normal text-slate-500">MB</span>
          </div>
          <Progress value={status ? (status.availableKeyBits / status.maxPoolCapacityBits) * 100 : 0} className="mt-4 h-2" />
        </div>

        <div className="border rounded-xl p-4 bg-white dark:bg-slate-950">
          <div className="text-sm font-medium text-slate-500 mb-1">Secret Key Rate</div>
          <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
            {latest ? (latest.secretKeyRateBps / 1000).toFixed(1) : '-'} <span className="text-lg font-normal">kbps</span>
          </div>
          <div className="text-xs text-slate-400 mt-2">Toeplitz Privacy Amplification</div>
        </div>

        <div className="border rounded-xl p-4 bg-white dark:bg-slate-950">
          <div className="text-sm font-medium text-slate-500 mb-1">Quantum Bit Error Rate</div>
          <div className={`text-3xl font-bold ${latest?.qber > 0.08 ? 'text-red-500' : latest?.qber > 0.04 ? 'text-orange-500' : 'text-slate-900 dark:text-white'}`}>
            {latest ? (latest.qber * 100).toFixed(2) : '-'} <span className="text-lg font-normal">%</span>
          </div>
          <div className="text-xs text-slate-400 mt-2">Shor-Preskill Bound: 11%</div>
        </div>

        <div className="border rounded-xl p-4 bg-white dark:bg-slate-950">
          <div className="text-sm font-medium text-slate-500 mb-1">Channel Status</div>
          <div className="text-xl font-bold mt-2 flex items-center gap-2">
            {latest?.channelState === 'NORMAL' ? <span className="text-emerald-500 flex items-center gap-2"><ShieldCheck/> Secure</span> :
             latest?.channelState === 'TURBULENCE' ? <span className="text-orange-500 flex items-center gap-2"><Activity/> Noisy</span> :
             latest?.channelState === 'ANOMALOUS' ? <span className="text-red-500 flex items-center gap-2"><ShieldAlert/> Intercepted</span> :
             <span className="text-slate-500 flex items-center gap-2"><Zap/> Dead</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <div className="lg:col-span-2 border rounded-xl p-6 bg-white dark:bg-slate-950">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <Activity className="h-5 w-5" /> Live QBER vs Secret Key Rate
          </h3>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey="timestamp" tickFormatter={(v) => new Date(v).toLocaleTimeString()} tick={{fontSize: 12}} stroke="#64748b" />
                
                <YAxis yAxisId="left" tickFormatter={(v) => `${(v*100).toFixed(0)}%`} domain={[0, 0.15]} stroke="#64748b" />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} stroke="#64748b" />
                
                <Tooltip 
                  labelFormatter={(v) => new Date(v).toLocaleTimeString()}
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                />
                
                <ReferenceLine y={0.11} yAxisId="left" stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'Security Bound', fill: '#ef4444', fontSize: 12 }} />
                
                <Line yAxisId="left" type="monotone" dataKey="qber" stroke="#06b6d4" strokeWidth={2} dot={false} name="QBER" />
                <Line yAxisId="right" type="stepAfter" dataKey="secretKeyRateBps" stroke="#10b981" strokeWidth={2} dot={false} name="Key Rate (bps)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI Anomaly Log */}
        <div className="border rounded-xl flex flex-col bg-white dark:bg-slate-950 overflow-hidden">
          <div className="p-4 border-b bg-slate-50 dark:bg-slate-900 font-semibold flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-500" /> AI Anomaly Detections
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            {anomalies.length === 0 ? (
              <div className="text-center text-slate-500 py-8">No anomalies detected recently.</div>
            ) : (
              <div className="space-y-4">
                {anomalies.map((a, i) => (
                  <div key={i} className="border-l-4 border-red-500 pl-4 py-2">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-sm text-red-600 dark:text-red-400">{a.anomalyClassification}</span>
                      <span className="text-xs text-slate-500">{new Date(a.recordedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                      {a.anomalyExplanation}
                    </div>
                    {a.privacyAmplificationNeeded && (
                      <div className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 p-2 rounded">
                        <strong>Action:</strong> Applied privacy amplification ratio {a.privacyAmplificationRatio?.toFixed(3)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
