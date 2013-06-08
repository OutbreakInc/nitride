var childProcess = require("child_process");

//objective:
//  turn the following high-level actions into sequences of gdb commands:
//    build, flash, restart-run, restart-paused, set-breakpoints, run, pause, set-expression
//  notify on the following events:
//    halted, async-error


Command.prototype =
{
	command: undefined,
	callback: undefined,
	response: "",
	error: false
};
function Command(cmd, callback)
{
	this.command = cmd || "";
	this.callback = callback || function()
	{
		console.log("(no callback associated with command \"" + cmd + "\".)");
	};
}

CodeTalker.prototype =
{
	build: function CodeTalker_build()
	{
	},
	
	flash: function CodeTalker_flash()
	{
	},
	
	restartRun: function CodeTalker_restartRun()
	{
	},
	
	restartPaused: function CodeTalker_restartPaused()
	{
	},
	
	setBreakpoints: function CodeTalker_setBreakpoints()
	{
	},
	
	run: function CodeTalker_run()
	{
	},
	
	pause: function CodeTalker_pause()
	{
	},
	
	setExpression: function CodeTalker_setExpression()
	{
	},
	
	submit: function CodeTalker_submit(command, callback)
	{
		this._tasks.push(new Command(command, callback));
		if(!this._tasksActive)
			this.nextTask();
		else
			console.log("not spurring queue.");
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
	_tasks: []
}
function CodeTalker(processPath, processArgs)
{
	var ths = this;
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
		//console.log("stdout: ", d);
		
		//parse gdb output
		if(d.substr(-6) == "(gdb) ")
		{
			console.log("detected gdb prompt, task is complete");
			
			if(ths._tasks.length > 0)
			{
				var task = ths._tasks.shift();
				
				task.response += d.substr(0, d.length - 6);
				
				if(ths._tasks.length == 0)
					_tasksActive = false;
				
				//tasks added between here
				var outerTasks = ths._tasks;
				ths._tasks = [];
				
				task.callback(task);
				
				ths._tasks = ths._tasks.concat(outerTasks);
				//..and here get prioritized before any others
				
				ths.nextTask();
			}
		}
		else if(ths._tasks.length > 0)
		{
			ths._tasks[0].response += d;
		}
	});
	
	process.stderr.on("data", function(d)
	{
		//console.log("stderr: ", d);
		
		if(ths._tasks.length > 0)
		{
			ths._tasks[0].response += d;
			ths._tasks[0].error = true;
		}
	});
	
	process.on("exit", function(code)
	{
		console.log("process exited with: ", code);

		if(ths._restartWhenDied)
		{
			console.log("Respawning process in a moment...");
			setTimeout(function(){ths.spawn(processArgs, port)}, 500);
		}
	});
	
	ths._process = process;
	
	ths._tasks.push({callback: function()
	{
		console.log("gdb ready.");
	}});
	ths._tasksActive = true;
}



var gdb = new CodeTalker("/Users/kuy/Projects/Galago/galago-ide/SDK/bin/arm-elf-gdb", ["/Users/kuy/Projects/Galago/ide/ardbeg/testProject/module.elf"]);

gdb.submit("target remote localhost:1033", function(taskContext)
{
	console.log("task completed with: >>" + taskContext.response + "<<");
});


//testing:
process.stdin.on("data", function(d)
{
	console.log("data");
	gdb.submit(d, function(taskContext)
	{
		console.log("response: ", taskContext.response);
	});
});
process.stdin.resume();
