var path = require("path");
module.exports =
{
	baseDir: function baseDir()
	{
		switch(process.platform)
		{
		case "darwin":	return(path.join(process.env["HOME"], "Library/Application Support/Logiblock/modules"));
		default:
		case "linux":	return(path.join(process.env["HOME"], ".logiblock/modules"));
		case "win32":	return(path.join(process.env["APPDATA"], "Logiblock", "modules"));
		}
	},
	modulesDir: function modulesDir()
	{
		switch(process.platform)
		{
		case "darwin":	return(path.join(process.env["HOME"], "Documents/Logiblock/modules"));
		default:
		case "linux":	return(path.join(process.env["HOME"], "logiblock/modules"));
		case "win32":	return(path.join(process.env["HOMEDIR"], "Logiblock", "modules"));
		}
	},
	sdkName: function sdkName()
	{
		switch(process.platform)
		{
		case "darwin":	return("sdk-arm-gcc-mac64");
		default:
		case "linux":	return("sdk-arm-gcc-linux64");
		case "win32":	return("sdk-arm-gcc-win32");
		}
	},
};
