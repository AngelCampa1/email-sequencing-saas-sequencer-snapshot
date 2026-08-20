#!/usr/bin/env node
import { Command } from 'commander'
import { accessTokenTemplateCommand } from './commands/access-token-template.js'
import { compileCommand } from './commands/compile.js'
import { diffCommand } from './commands/diff.js'
import { dlqCommand } from './commands/dlq.js'
import { dryRunCommand } from './commands/dry-run.js'
import { leadMagnetAssetsCommand } from './commands/lead-magnet-assets.js'
import { leadMagnetSqlCommand } from './commands/lead-magnet-sql.js'
import { readinessCommand } from './commands/readiness.js'
import { rotCommand } from './commands/rot.js'
import { secretTemplateCommand } from './commands/secret-template.js'
import { syncCommand } from './commands/sync.js'
import { tokenSqlCommand } from './commands/token-sql.js'

const program = new Command().name('seq').description('Ventora Sequencer CLI').version('0.1.0')

program.addCommand(compileCommand)
program.addCommand(diffCommand)
program.addCommand(dryRunCommand)
program.addCommand(rotCommand)
program.addCommand(syncCommand)
program.addCommand(readinessCommand)
program.addCommand(tokenSqlCommand)
program.addCommand(secretTemplateCommand)
program.addCommand(accessTokenTemplateCommand)
program.addCommand(leadMagnetSqlCommand)
program.addCommand(leadMagnetAssetsCommand)
program.addCommand(dlqCommand)

program.parse()
