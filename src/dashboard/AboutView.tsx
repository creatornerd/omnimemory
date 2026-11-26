import { Mail } from 'lucide-react';
import { Logo } from '../ui/components/primitives';
import { TRADEMARK_NOTICE } from '../shared/sites';

/**
 * About the developer. The bio is copied word for word from the developer's
 * page on findmyspecialist.vercel.app/about. Links open in a new tab; this
 * page loads nothing from the network itself.
 */
export const BIO = {
  name: 'Ahaan Hossain',
  initials: 'AH',
  text: "Ahaan is a 13-year-old student developer, located in the tech hub of the Pacific Northwest, currently in middle school. He has a passion for building tools that solve real problems and is always seeking feedback to make his projects better. When he isn't on the computer, Ahaan enjoys doing extracurriculars like piano, robotics, and Math. Access his github to see the code or more details about the project and contact him with any issues via email using the links below, and check out his other projects!",
  github: 'https://github.com/creatornerd',
  email: 'ahaan.hossain@yahoo.com',
  otherProject: { label: 'FindMyPro', url: 'https://findmyspecialist.vercel.app' },
} as const;

function GithubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function AboutView() {
  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-10 pt-10 pb-16 max-md:px-5">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">About OmniMemory</h1>
            <p className="text-[13px] text-ink-3">One memory for ChatGPT, Claude and Gemini.</p>
          </div>
        </div>

        <h2 className="mt-9 mb-3 text-[15px] font-semibold">The developer</h2>
        <section className="rounded-[14px] border border-line bg-surface p-6">
          <div className="flex items-center gap-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-accent-fg">
              {BIO.initials}
            </span>
            <div className="text-[17px] font-semibold tracking-[-0.01em]">{BIO.name}</div>
          </div>
          <p className="mt-4 text-[14.5px] leading-[1.65] text-ink-2">{BIO.text}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href={BIO.github}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-[34px] items-center gap-2 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
            >
              <GithubIcon />
              GitHub
            </a>
            <a
              href={`mailto:${BIO.email}`}
              className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium hover:bg-subtle"
            >
              <Mail size={15} />
              {BIO.email}
            </a>
            <a
              href={BIO.otherProject.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium hover:bg-subtle"
            >
              Other project: {BIO.otherProject.label}
            </a>
          </div>
        </section>

        <h2 className="mt-9 mb-3 text-[15px] font-semibold">Your privacy</h2>
        <section className="rounded-[14px] border border-line bg-surface p-6 text-[13.5px] leading-relaxed text-ink-2">
          OmniMemory has no account and no server. Your memories are stored in this browser, on this device. Sync talks only
          to the chatbot site you’re on, with your normal sign-in, and the optional assistant talks to Gemini only after you
          turn it on.
          <p className="mt-3">
            Using OmniMemory means you agree to the{' '}
            <a href="https://omnimemory.vercel.app/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
              Terms of Use
            </a>{' '}
            and the{' '}
            <a href="https://omnimemory.vercel.app/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
              Privacy Policy
            </a>
            . OmniMemory is free and provided as is: keep a backup with Settings → Export.
          </p>
        </section>

        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-3">{TRADEMARK_NOTICE}</p>
      </div>
    </div>
  );
}
