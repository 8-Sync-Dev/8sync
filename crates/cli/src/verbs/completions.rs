//! `8sync completions <shell>`: print a tab-completion script for the `8sync` command tree.
//! Generated from the same clap tree `main` parses (brand-rewritten), so every verb, alias and
//! flag completes exactly as the binary accepts it. Install (bash example):
//! `8sync completions bash > ~/.local/share/bash-completion/completions/8sync`.

use std::io::Write;

use anyhow::Result;
use clap::Args as ClapArgs;
use clap_complete::Shell;

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
EXAMPLES
  8sync completions bash > ~/.local/share/bash-completion/completions/8sync
  8sync completions zsh  > ~/.zfunc/_8sync          # fpath+=(~/.zfunc); autoload -U compinit
  8sync completions fish > ~/.config/fish/completions/8sync.fish
  8sync completions powershell >> $PROFILE
"})]
pub struct Args {
    /// Shell to generate for
    #[arg(value_enum)]
    pub shell: Shell,
}

pub fn run(a: Args) -> Result<()> {
    let mut out = Vec::new();
    generate(a.shell, &mut out);
    std::io::stdout().write_all(&out)?;
    Ok(())
}

/// The script for `shell`, into `out`.
pub(crate) fn generate(shell: Shell, out: &mut Vec<u8>) {
    let mut cmd = crate::command();
    let name = cmd.get_name().to_string();
    clap_complete::generate(shell, &mut cmd, name, out);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script(shell: Shell) -> String {
        let mut out = Vec::new();
        generate(shell, &mut out);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn completions_bash_lists_ccc_and_itself() {
        let s = script(Shell::Bash);
        assert!(s.contains("ccc"), "bash script must complete the ccc verb");
        assert!(s.contains("completions"));
        assert!(s.contains("8sync"));
    }

    #[test]
    fn completions_every_shell_generates() {
        for sh in [Shell::Zsh, Shell::Fish, Shell::PowerShell, Shell::Elvish] {
            let s = script(sh);
            assert!(s.len() > 1000, "{sh:?} script too short: {} bytes", s.len());
            assert!(s.contains("ccc"), "{sh:?} lacks ccc");
        }
    }
}
