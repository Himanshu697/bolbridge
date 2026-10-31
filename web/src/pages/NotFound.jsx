import { Logo } from '../components/ui.jsx';
import { Link } from '../router.jsx';

export default function NotFound() {
  return (
    <div className="container stack" style={{ padding: '64px 24px', gap: 20 }}>
      <Logo />
      <h1 style={{ fontSize: 36 }}>This page doesn't exist</h1>
      <Link to="/" className="btn primary" style={{ alignSelf: 'flex-start' }}>Go to the home page</Link>
    </div>
  );
}
