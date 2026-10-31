import { useNavigate } from 'react-router-dom';
import { DialogShell } from '../../components/exchange/site';
import { useSession } from '../../hooks/exchange/site';
import { useDisplayCurrency } from '@/hooks/useWallet';

/**
 * The exchange is INR-only (hash owner rule, 2026-10-19): any `/sports` page with a non-INR header
 * wallet asks to switch. Switch to INR sets the header wallet's coin (bitcasino: `useDisplayCurrency`);
 * Go back, the cross and Escape all leave the sports pages for `/`. Mounted by pages/Sports.jsx.
 */
export default function SportsInrDialog() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [currency, setCurrency] = useDisplayCurrency();
  if (!session?.login || currency === 'INR') return null;

  const leave = () => navigate('/');

  return (
    <DialogShell title="Sports betting is in INR" onClose={leave}>
      <div className="pb-4 pt-2">
        <p className="text-sm text-secondary">Sports betting is in INR — switch your currency to INR to continue.</p>
        <div className="mt-6 flex gap-3">
          <button type="button" className="button button-m button-second flex-1" onClick={leave}>
            Go back
          </button>
          <button type="button" className="button button-m button-brand flex-1" onClick={() => setCurrency('INR')}>
            Switch to INR
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
