var childProcess = require("child_process");
//var util = require("util");

//objective:
//  turn the following high-level actions into sequences of gdb commands:
//    build, flash, restart-run, restart-paused, set-breakpoints, run, pause, set-expression
//  notify on the following events:
//    halted, async-error


function parseGDB_MI(response)
{
	var o = {};
	_parse_inner(response.match(/("([^"\\]|\\.)*")|,|([\w-]+)|=|\{|\}|\[|\]/g), o);
	return(o);
}

function _parse_inner(tokens, o)
{
	while(tokens.length > 0)
	{
		var t = tokens.shift(), k, v;
		switch(t)
		{
		case ",":
		case "}":
		case "]":
			if(v !== undefined)
				if(o instanceof Array)	o.push(v);
				else					o[k] = v;
			k = v = undefined;
			
			if(t == ",")	break;
			else			return;
		case "=":
			k = v;
			break;
		case "{":
			arguments.callee(tokens, v = {});
			break;
		case "[":
			arguments.callee(tokens, v = []);
			break;
		default:
			v = ((typeof t == "string") && (t[0] == '"'))? t.substr(1, t.length - 2) : t;
			if(!isNaN(v))	v = Number(v);
			break;
		}
	}
	if(o instanceof Array)	o.push(v);
	else					o[k] = v;
}

Command.prototype =
{
	command: undefined,
	callback: undefined,
	response: "",
	error: false,
	active: true,
	expectsResponse: true
};
function Command(cmd, expectsResponse, callback)
{
	this.command = cmd || "";
	this.active = true;
	this.expectsResponse = expectsResponse;
	this.callback = callback || function()
	{
		console.log("(no callback associated with command \"" + cmd + "\".)");
	};
}

CodeTalker.prototype =
{
	connect: function CodeTalker_connect(port, callback)
	{
		gdb.submit("-target-select remote localhost:" + port, function(taskContext)
		{
			if(taskContext.response == "connected")
			{
				this._connectedPort = port;
				callback();
			}
			else
			{
				console.log("connecting to the hardware failed!");
				callback(new Error("Could not connect to the specified device"));
			}
		}.bind(this));
	},

	build: function CodeTalker_build(callback)
	{
	},
	
	flash: function CodeTalker_flash(callback)
	{
		this.submit("-target-download", function()
		{
			if(taskContext.response == "done")
				callback();
			else
				callback(new Error("Firmware flash failed."));
		}.bind(this));
	},
	
	restartRun: function CodeTalker_restartRun()
	{
		this.submit("-exec-continue", function()
		{
			if(taskContext.response == "running")
				callback();
			else
				callback(new Error("Could not continue."));
		}.bind(this));
	},
	
	restartPaused: function CodeTalker_restartPaused()
	{
	},
	
	setBreakpoint: function CodeTalker_setBreakpoint()
	{
	},
	
	run: function CodeTalker_run(callback)
	{
		this.submit("-exec-continue", function(taskContext)
		{
			if(taskContext.response == "running")
			{
				//schedule callback for as soon as the *status changes
				this._statusCallback = function CodeTalker_run_onCompletion()
				{
					this._statusCallback = null;
					callback();
				}.bind(this);
			}
			else
				callback(new Error("Could not continue."));
		}.bind(this));
	},
	
	pause: function CodeTalker_pause(callback)
	{
		this.submit("-exec-interrupt", function(taskContext)
		{
			if(taskContext.response == "done")
			{
				//schedule callback for as soon as the *status changes
				this._statusCallback = function CodeTalker_pause_onCompletion()
				{
					this._statusCallback = null;
					callback(undefined, taskContext.args);
				}.bind(this);
			}
			else
				callback(new Error("Could not continue."));
		}.bind(this));
	},
	
	updateCallstack: function CodeTalker_updateCallstack(callback)
	{
		this.submit("-stack-list-frames", function(taskContext)
		{
			if(taskContext.response == "done")
			{
				this._lastCallstack = taskContext.args.stack;
				this.submit("-stack-list-arguments --simple-values", function(taskContext)
				{
					if(taskContext.response == "done")
					{
						//merge args
						for(var i = 0; i < this._lastCallstack.length; i++)
							this._lastCallstack[i].args = taskContext.args["stack-args"][i].args;	//arg!

						callback(undefined, this._lastCallstack);
					}
					else
						callback(new Error("Could not fetch arguments for callstack."));
				}.bind(this));
			}
			else
				callback(new Error("Could not fetch callstack."));
		}.bind(this));
	},

	evalExpression: function CodeTalker_evalExpression()
	{
		;
	},
	
	setExpression: function CodeTalker_setExpression()
	{
	},
	
	submit: function CodeTalker_submit(command, expectsResponse, callback)
	{
		if(arguments.length == 2)
		{
			callback = expectsResponse;
			expectsResponse = true;
		}
		
		this._tasks.push(new Command(command, expectsResponse, callback));
		if(!this._tasksActive)
			this.nextTask();
		//else
		//	console.log("not spurring queue.");
	},
	nextTask: function CodeTalker_nextTask()
	{
		if(this._tasks.length == 0)
		{
			this._tasksActive = false;
			return;
		}
		
		//act on the task
		this._tasksActive = true;
		
		if(this._tasks[0].command == undefined)
			throw new Error("why??");
		
		console.log("submitting command: >>" + this._tasks[0].command + "<<");
		this._process.stdin.write(this._tasks[0].command + "\n");
	},
	cycleTask: function CodeTalker_cycleTask()
	{
		if(this._tasks.length > 0)
		{
			if(		this._tasks[0].active
					|| (this._tasks[0].expectsResponse && (this._tasks[0].response == undefined))
				)
				return;	//not finished yet

			var task = this._tasks.shift();
			
			if(this._tasks.length == 0)
				_tasksActive = false;
			
			//tasks added between here
			var outerTasks = this._tasks;
			this._tasks = [];
			
			task.callback(task);
			
			this._tasks = this._tasks.concat(outerTasks);
			//..and here get prioritized before any others
			
			this.nextTask();
		}
	},
	
	quit: function CodeTalker_quit()
	{
		if(this._process != null)
		{
			this._restartWhenDied = false;
			this._process.kill();
			this._process = null;
		}
	},
	
	_process: null,
	_restartWhenDied: true,
	_tasks: [],

	//state:
	_connectedPort:		undefined,
	_runState:			undefined,
	_statusCallback:	undefined,
	_stopReason:		undefined,
}
function CodeTalker(processPath, processArgs)
{
	var process = childProcess.spawn(processPath, processArgs,
		{
			env:
			{
			}
		});

	process.stdout.setEncoding("utf8");
	process.stderr.setEncoding("utf8");

	process.stdout.on("data", function(d)
	{
		console.log("stdout: >>", d, "<<");
		
		var response = d.trim().split("\n");

		for(var i = 0; i < response.length; i++)	//for each line
		{
			var r = response[i].trim();
			
			var token = r.match(/^\d+/);
			if(token != null)	token = token[0];

			//parse gdb output
			if(r == "(gdb)")
			{
				if(this._tasks[0])
					this._tasks[0].active = false;
				else
					console.log("ERROR >>>> prompt received for a task that has completed already!");

				this.cycleTask();
			}
			else
			{
				var command, args, commaSplit = r.indexOf(",");
				if(commaSplit >= 0)
				{
					command = r.substr(0, commaSplit);
					args = parseGDB_MI(r.substr(commaSplit + 1));
				}
				else
					command = r;

				var sym = command.substr(0, 1)
				if(sym == "^")
				{
					//complete a command with this response
					if(this._tasks[0])
					{
						this._tasks[0].response = command.substr(1);
						this._tasks[0].args = args;
					}
					else
						console.log("ERROR >>>> response received for a task that has completed already!");

					this.cycleTask();
				}
				else if(sym == "~")
				{
					console.log("GDB: ", command);
				}
				else if(sym == "&")
				{
					console.log("GDB: ", command);
				}
				else switch(command)
				{
				case "*stopped":
					console.log("update run state with: ", command, " and args: ", args);
					this._runState = "stopped";
					this._stopReason = args;
					if(this._statusCallback)
						this._statusCallback();
					break;
				case "*running":
					console.log("update run state with: ", command, " and args: ", args);
					this._runState = "running";
					if(this._statusCallback)
						this._statusCallback();
					break;
				case "=breakpoint-modified":
					console.log("update breakpoint table with: ", args);
					break;
				}
			}
		}
	}.bind(this));
	
	process.stderr.on("data", function(d)
	{
		console.log("stderr: ", d);
		
		if(this._tasks.length > 0)
		{
			//this._tasks[0].response += d;
			this._tasks[0].error = true;
		}
	}.bind(this));
	
	process.on("exit", function(code)
	{
		console.log("process exited with: ", code);

		if(this._restartWhenDied)
		{
			console.log("Respawning process in a moment...");
			setTimeout(function(){this.spawn(processArgs, port)}, 500);
		}
	}.bind(this));
	
	this._process = process;
	
	//prime the task queue
	var initialCommand = new Command("", false, function()
	{
		console.log("gdb started.");
	});
	this._tasks.push(initialCommand);
	this._tasksActive = true;

	//first real task
	this.submit("-gdb-set target-async 1", function()
	{
		console.log("gdb ready.");
	});
}


var gdb = new CodeTalker("/Users/kuy/Projects/Galago/galago-ide/SDK/bin/arm-elf-gdb", ["--interpreter=mi2", "/Users/kuy/Projects/Galago/ide/ardbeg/testProject/module.elf"]);

function genericCompletion(taskContext)
{
	console.log("task \"" + taskContext.command + "\" completed with: ", taskContext.response, " and args: ", taskContext.args);
}

//testing:
process.stdin.setEncoding("utf8");
process.stdin.on("data", function(d)
{
	d = String(d).trim();
	var method = d.split(" ");
	if(CodeTalker.prototype[method[0]])
	{
		method.push(function()
		{
			console.log("completed with arguments: ", arguments, " >>> ", JSON.stringify(arguments[1]));
		});
		CodeTalker.prototype[method.shift()].apply(gdb, method);
	}
	else
		gdb.submit(d, genericCompletion);
});
process.stdin.resume();
