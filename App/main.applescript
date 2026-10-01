-- Usage Pace.app: opening it installs (or refreshes) Usage Pace and offers
-- to uninstall it. The login item opens it when a newer release exists, and
-- it then shows the update dialog instead. The work happens in usage-pace.sh
-- next to this script.

property releasesURL : "https://github.com/LukasvanUden/usage-pace-for-claude/releases/latest"

on run
	set german to (user locale of (system info)) starts with "de"
	set appPath to POSIX path of (path to me)

	-- Written by usage-pace.sh when it finds a newer release.
	set marker to POSIX path of (path to application support from user domain) & "Usage Pace/update-available"
	set latest to ""
	try
		set latest to do shell script "/bin/cat " & quoted form of marker & " && /bin/rm -f " & quoted form of marker
	end try
	if latest is not "" then
		showUpdate(latest, german)
		return
	end if

	-- The login item runs from the app bundle, so it has to stay in Applications.
	if appPath does not contain "/Applications/" then
		if german then
			display dialog "Zieh „Usage Pace“ zuerst in den Ordner „Programme“ und öffne es dort." buttons {"OK"} default button 1 with icon caution
		else
			display dialog "Move Usage Pace to your Applications folder first, then open it there." buttons {"OK"} default button 1 with icon caution
		end if
		return
	end if

	set tool to "/bin/sh " & quoted form of (appPath & "Contents/Resources/usage-pace.sh")
	set wasInstalled to (do shell script tool & " status") is "installed"
	do shell script tool & " install"

	if not wasInstalled then
		if german then
			display dialog "Usage Pace ist installiert." & return & return & "Beende Claude einmal mit ⌘Q und öffne es wieder. Deine Nutzung erscheint dann unter „Mehr“ und im Nutzungs-Popover." buttons {"OK"} default button 1
		else
			display dialog "Usage Pace is installed." & return & return & "Quit Claude once with ⌘Q and open it again. Your usage then shows below “More” and in the usage popover." buttons {"OK"} default button 1
		end if
		return
	end if

	set current to do shell script tool & " version"
	if german then
		set choice to button returned of (display dialog "Usage Pace " & current & " ist aktiv." buttons {"Deinstallieren", "OK"} default button "OK")
	else
		set choice to button returned of (display dialog "Usage Pace " & current & " is active." buttons {"Uninstall", "OK"} default button "OK")
	end if
	if choice is "OK" then return

	do shell script tool & " uninstall"
	if german then
		display dialog "Usage Pace ist entfernt." & return & return & "Beende Claude einmal mit ⌘Q und öffne es wieder. Die App kannst du jetzt in den Papierkorb legen." buttons {"OK"} default button 1
	else
		display dialog "Usage Pace is removed." & return & return & "Quit Claude once with ⌘Q and open it again. You can now move this app to the Trash." buttons {"OK"} default button 1
	end if
end run

on showUpdate(latest, german)
	if german then
		set choice to button returned of (display dialog "Usage Pace " & latest & " ist verfügbar." & return & return & "Lade die neue Version herunter, zieh sie nach „Programme“ und öffne sie einmal." & return & return & "Per git installiert? Im Projektordner: bash Scripts/update.sh" buttons {"Später", "Herunterladen"} default button "Herunterladen")
		if choice is "Herunterladen" then open location releasesURL
	else
		set choice to button returned of (display dialog "Usage Pace " & latest & " is available." & return & return & "Download the new version, move it to Applications and open it once." & return & return & "Installed with git? In the project folder: bash Scripts/update.sh" buttons {"Later", "Download"} default button "Download")
		if choice is "Download" then open location releasesURL
	end if
end showUpdate
