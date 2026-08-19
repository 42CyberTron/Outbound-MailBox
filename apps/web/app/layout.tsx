import './globals.css'; import { AuthProvider } from './providers';
export const metadata={title:'Mail Scheduler',description:'Reliable email scheduling'};
export default function Layout({children}:{children:React.ReactNode}){return <html><body><AuthProvider>{children}</AuthProvider></body></html>}
